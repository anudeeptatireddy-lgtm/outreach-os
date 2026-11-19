"""The FastAPI application: API routes, the unsubscribe page, webhooks and the built dashboard."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import time
from contextlib import asynccontextmanager
from html import escape

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from outreach.playbook import sprinto_playbook
from outreach.server import VERSION
from outreach.server.config import ServerConfig, get_config
from outreach.server.db import Database, Message, PlaybookRow, Prospect, Suppression, User, Workspace, utcnow
from outreach.server.deps import Caller, Services, caller, get_db, services
from outreach.server.security import (
    SESSION_COOKIE, SESSION_MAX_AGE, Crypto, RateLimiter, hash_password, verify_password,
)
from outreach.server.serialize import settings_dict
from outreach.server.worker import BackgroundWorker, tick
from outreach.server.workspace import SECRET_NAMES, get_secret, log_event, set_secrets, update_settings

log = logging.getLogger("outreach.app")
_EMAIL = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")
_login_limiter = RateLimiter(10, 60)


# --------------------------------------------------------------------------- app factory


def create_app(cfg: ServerConfig | None = None, *, start_worker: bool | None = None) -> FastAPI:
    cfg = cfg or get_config()
    database = Database(cfg.database_url)
    database.create_all()
    svc = Services(database=database, crypto=Crypto(cfg.secret_key), cfg=cfg)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        run = cfg.worker_enabled if start_worker is None else start_worker
        if run:
            svc.worker = BackgroundWorker(database, svc.crypto, cfg)
            svc.worker.start()
        yield
        if svc.worker is not None:
            svc.worker.stop()

    app = FastAPI(title="outreach-os", version=VERSION, lifespan=lifespan, docs_url="/api/docs",
                  openapi_url="/api/openapi.json", redoc_url=None)
    app.state.services = svc

    from fastapi.exceptions import HTTPException as FastHTTPException

    @app.exception_handler(FastHTTPException)
    async def http_error(request: Request, exc: FastHTTPException):
        if isinstance(exc.detail, dict):
            return JSONResponse(exc.detail, status_code=exc.status_code)
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(Exception)
    async def crash(request: Request, exc: Exception):
        log.exception("unhandled error on %s", request.url.path)
        return JSONResponse({"detail": "internal error"}, status_code=500)

    @app.middleware("http")
    async def guards(request: Request, call_next):
        path = request.url.path
        if (path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH", "DELETE")
                and not path.startswith(("/api/webhooks/", "/api/cron/"))):
            ctype = request.headers.get("content-type", "")
            if request.method != "DELETE" and "application/json" not in ctype:
                return JSONResponse({"detail": "send JSON (Content-Type: application/json)"}, status_code=415)
            if request.method == "DELETE" and request.headers.get("x-requested-with") != "outreach-os" \
                    and "application/json" not in ctype:
                return JSONResponse({"detail": "missing X-Requested-With header"}, status_code=415)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        if not path.startswith("/u/"):
            response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    from outreach.server.routes import campaigns, messages, playbooks

    app.include_router(_core_router())
    app.include_router(playbooks.router)
    app.include_router(campaigns.router)
    app.include_router(messages.router)
    _mount_frontend(app, cfg)
    return app


# --------------------------------------------------------------------------- core routes


class SignupIn(BaseModel):
    email: str
    password: str
    name: str
    workspace_name: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


def _session_payload(user: User, ws: Workspace) -> dict:
    return {"user": {"id": user.id, "email": user.email, "name": user.name},
            "workspace": {"id": ws.id, "name": ws.name, "onboarded": ws.onboarded, "demo_mode": ws.demo_mode}}


def _set_cookie(resp: Response, svc: Services, user_id: int) -> None:
    resp.set_cookie(SESSION_COOKIE, svc.crypto.make_session(user_id), max_age=SESSION_MAX_AGE, httponly=True,
                    samesite="lax", secure=svc.cfg.secure_cookies, path="/")


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def seed_workspace(db: Session, ws: Workspace) -> PlaybookRow:
    pb = sprinto_playbook()
    row = PlaybookRow(workspace_id=ws.id, name=pb.name, template="sprinto", data=pb.model_dump(mode="json"))
    db.add(row)
    return row


def _core_router():
    from fastapi import APIRouter

    r = APIRouter()

    @r.get("/api/health")
    def health(svc: Services = Depends(services)):
        worker = "running" if svc.worker is not None and svc.worker.running else "stopped"
        return {"ok": True, "version": VERSION, "worker": worker}

    # ---- auth
    @r.post("/api/auth/signup")
    def signup(body: SignupIn, request: Request, response: Response, db: Session = Depends(get_db),
               svc: Services = Depends(services)):
        if not _login_limiter.allow("signup:" + _client_ip(request)):
            raise HTTPException(429, "too many attempts, try again in a minute")
        email = body.email.strip().lower()
        if not _EMAIL.match(email):
            raise HTTPException(422, "enter a valid email address")
        if len(body.password) < 8:
            raise HTTPException(422, "password must be at least 8 characters")
        if not body.name.strip():
            raise HTTPException(422, "enter your name")
        if db.scalar(select(User).where(User.email == email)):
            raise HTTPException(409, "an account with this email already exists")
        ws = Workspace(name=(body.workspace_name.strip() or f"{body.name.strip()}'s workspace")[:120],
                       demo_mode=True, settings={"sending": {"owner_email": email, "from_name": body.name.strip()}})
        db.add(ws)
        db.flush()
        user = User(email=email, name=body.name.strip()[:120], password_hash=hash_password(body.password),
                    workspace_id=ws.id)
        db.add(user)
        try:
            db.flush()
        except IntegrityError:
            raise HTTPException(409, "an account with this email already exists") from None
        seed_workspace(db, ws)
        log_event(db, ws.id, "workspace_created", f"Workspace created by {user.name}. Demo mode is on.", level="success")
        _set_cookie(response, svc, user.id)
        return _session_payload(user, ws)

    @r.post("/api/auth/login")
    def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db),
              svc: Services = Depends(services)):
        email = body.email.strip().lower()
        if not _login_limiter.allow(f"login:{_client_ip(request)}:{email}"):
            raise HTTPException(429, "too many attempts, try again in a minute")
        user = db.scalar(select(User).where(User.email == email))
        if user is None or not verify_password(body.password, user.password_hash):
            raise HTTPException(401, "wrong email or password")
        _set_cookie(response, svc, user.id)
        return _session_payload(user, db.get(Workspace, user.workspace_id))

    @r.post("/api/auth/logout")
    def logout(response: Response):
        response.delete_cookie(SESSION_COOKIE, path="/")
        return {"ok": True}

    @r.get("/api/auth/me")
    def me(c: Caller = Depends(caller)):
        return _session_payload(c.user, c.ws)

    # ---- settings
    @r.get("/api/settings")
    def get_settings(c: Caller = Depends(caller), svc: Services = Depends(services)):
        return settings_dict(c.ws, svc.crypto, svc.cfg)

    @r.patch("/api/settings")
    def patch_settings(body: dict, c: Caller = Depends(caller), db: Session = Depends(get_db),
                       svc: Services = Depends(services)):
        ws = db.get(Workspace, c.ws.id)
        if "workspace_name" in body and str(body["workspace_name"]).strip():
            ws.name = str(body["workspace_name"]).strip()[:120]
        if "demo_mode" in body:
            ws.demo_mode = bool(body["demo_mode"])
        if "onboarded" in body:
            ws.onboarded = bool(body["onboarded"])
        patch: dict = {}
        if isinstance(body.get("sending"), dict):
            s = {k: v for k, v in body["sending"].items() if k in (
                "mode", "provider", "from_name", "from_email", "reply_to", "owner_email", "physical_address",
                "daily_cap", "send_window")}
            if "mode" in s and s["mode"] not in ("test", "live"):
                raise HTTPException(422, "sending.mode must be test or live")
            if "provider" in s and s["provider"] not in (None, "gmail", "resend"):
                raise HTTPException(422, "sending.provider must be gmail or resend")
            for key in ("owner_email", "from_email", "reply_to"):
                if s.get(key) and not _EMAIL.match(str(s[key]).strip()):
                    raise HTTPException(422, f"sending.{key} must be one email address")
            if "daily_cap" in s:
                s["daily_cap"] = max(1, min(2000, int(s["daily_cap"])))
            if "send_window" in s and isinstance(s["send_window"], dict):
                w = s["send_window"]
                sh, eh = int(w.get("start_hour", 9)), int(w.get("end_hour", 17))
                if not (0 <= sh < eh <= 24):
                    raise HTTPException(422, "send window must satisfy 0 <= start_hour < end_hour <= 24")
            patch["sending"] = s
            if s.get("mode") == "live":
                from outreach.server.mailer import live_ready

                tmp = Workspace(id=ws.id, name=ws.name, settings=ws.settings, secrets=ws.secrets)
                update_settings(tmp, {"sending": s})
                missing = live_ready(tmp, svc.crypto, svc.cfg)
                if missing:
                    raise HTTPException(422, "live sending needs: " + "; ".join(missing))
        if isinstance(body.get("models"), dict):
            m = {k: str(v).strip() for k, v in body["models"].items() if k in ("smart", "fast") and str(v).strip()}
            for v in m.values():
                if "latest" in v or "preview" in v:
                    raise HTTPException(422, "use a pinned model id (no 'latest' or 'preview')")
            patch["models"] = m
        if isinstance(body.get("hunter"), dict) and "monthly_budget" in body["hunter"]:
            patch["hunter"] = {"monthly_budget": max(0, int(body["hunter"]["monthly_budget"]))}
        if patch:
            update_settings(ws, patch)
        return settings_dict(ws, svc.crypto, svc.cfg)

    @r.put("/api/settings/secrets")
    def put_secrets(body: dict, c: Caller = Depends(caller), db: Session = Depends(get_db),
                    svc: Services = Depends(services)):
        ws = db.get(Workspace, c.ws.id)
        values = {k: (str(v) if v is not None else None) for k, v in body.items() if k in SECRET_NAMES}
        if values.get("gmail_user") and not _EMAIL.match(values["gmail_user"].strip()):
            raise HTTPException(422, "gmail_user must be an email address")
        if values.get("gmail_app_password"):
            values["gmail_app_password"] = values["gmail_app_password"].replace(" ", "")
        set_secrets(ws, values, svc.crypto)
        if values:
            log_event(db, ws.id, "settings", "Integration keys updated: " + ", ".join(sorted(values)))
        return settings_dict(ws, svc.crypto, svc.cfg)

    @r.post("/api/settings/test/{name}")
    def test_integration(name: str, c: Caller = Depends(caller), db: Session = Depends(get_db),
                         svc: Services = Depends(services)):
        ws = db.get(Workspace, c.ws.id)
        if name in ("gmail", "resend"):
            from outreach.server.mailer import send_test_email

            ok, detail = send_test_email(ws, name, svc.crypto, svc.cfg)
            return {"ok": ok, "detail": detail}
        if name == "gemini":
            key = get_secret(ws, "gemini_api_key", svc.crypto, svc.cfg)
            if not key:
                return {"ok": False, "detail": "No Gemini API key set"}
            try:
                from google import genai

                models = list(genai.Client(api_key=key).models.list(config={"page_size": 5}))
                return {"ok": True, "detail": f"Key works ({len(models)}+ models visible)"}
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "detail": f"Gemini rejected the request: {type(exc).__name__}"}
        if name == "hunter":
            key = get_secret(ws, "hunter_api_key", svc.crypto, svc.cfg)
            if not key:
                return {"ok": False, "detail": "No Hunter API key set"}
            try:
                from outreach.hunter import HunterClient

                acct = HunterClient(key, svc.cfg.cache_root / "hunter-test", 0).account()
                return {"ok": True, "detail": f"Key works: plan {acct.get('plan')}, {acct.get('remaining')} credits left"}
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "detail": str(exc)[:200]}
        raise HTTPException(404, "unknown integration")

    # ---- worker
    @r.post("/api/worker/tick")
    def worker_tick(c: Caller = Depends(caller), svc: Services = Depends(services)):
        return tick(svc.database, svc.crypto, svc.cfg, workspace_id=c.ws.id, budget_s=20)

    @r.get("/api/cron/tick")
    def cron_tick(request: Request, svc: Services = Depends(services)):
        secret = svc.cfg.cron_secret
        if not secret or not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {secret}"):
            raise HTTPException(401, "bad cron secret")
        return tick(svc.database, svc.crypto, svc.cfg, budget_s=50)

    # ---- unsubscribe (public)
    @r.get("/u/{token}", response_class=HTMLResponse)
    def unsubscribe_page(token: str, db: Session = Depends(get_db)):
        msg = db.scalar(select(Message).where(Message.unsubscribe_token == token))
        if msg is None:
            return HTMLResponse(_page("Link not found", "This unsubscribe link is not valid."), status_code=404)
        done = db.scalar(select(func.count()).select_from(Suppression).where(
            Suppression.workspace_id == msg.workspace_id, Suppression.value == msg.to_email.lower())) > 0
        if done:
            return _page("You are unsubscribed", f"{escape(msg.to_email)} will not receive further emails.")
        return _page("Unsubscribe", f"Stop all further emails to <b>{escape(msg.to_email)}</b>?",
                     form=f'<form method="post" action="/u/{escape(token)}"><button>Unsubscribe</button></form>')

    @r.post("/u/{token}", response_class=HTMLResponse)
    def unsubscribe(token: str, db: Session = Depends(get_db)):
        msg = db.scalar(select(Message).where(Message.unsubscribe_token == token))
        if msg is None:
            return HTMLResponse(_page("Link not found", "This unsubscribe link is not valid."), status_code=404)
        suppress(db, msg.workspace_id, msg.to_email, "unsubscribed")
        stop_prospect(db, msg.prospect_id, "unsubscribed")
        log_event(db, msg.workspace_id, "unsubscribed", f"{msg.to_email} unsubscribed", level="warning",
                  campaign_id=msg.campaign_id, prospect_id=msg.prospect_id)
        return _page("You are unsubscribed", f"{escape(msg.to_email)} will not receive further emails.")

    # ---- Resend webhooks (Svix-signed)
    @r.post("/api/webhooks/resend/{workspace_id}")
    async def resend_webhook(workspace_id: int, request: Request, svc: Services = Depends(services)):
        body = await request.body()
        with svc.database.session() as db:
            ws = db.get(Workspace, workspace_id)
            secret = get_secret(ws, "resend_webhook_secret", svc.crypto, svc.cfg) if ws else ""
            if not secret or not _svix_ok(secret, request.headers, body):
                raise HTTPException(401, "bad signature")
            event = json.loads(body or b"{}")
            kind = event.get("type", "")
            email_id = (event.get("data") or {}).get("email_id")
            msg = db.scalar(select(Message).where(Message.workspace_id == workspace_id, Message.provider_id == email_id))
            if msg is None:
                return {"ok": True, "matched": False}
            if kind == "email.bounced":
                msg.status = "bounced"
                suppress(db, workspace_id, msg.to_email, "bounced")
                stop_prospect(db, msg.prospect_id, "bounced")
                log_event(db, workspace_id, "bounced", f"{msg.to_email} bounced", level="error",
                          campaign_id=msg.campaign_id, prospect_id=msg.prospect_id)
            elif kind == "email.complained":
                suppress(db, workspace_id, msg.to_email, "spam complaint")
                stop_prospect(db, msg.prospect_id, "unsubscribed")
                log_event(db, workspace_id, "complained", f"{msg.to_email} marked the email as spam", level="error",
                          campaign_id=msg.campaign_id, prospect_id=msg.prospect_id)
            elif kind == "email.delivered":
                log_event(db, workspace_id, "delivered", f"Delivered to {msg.delivered_to}",
                          campaign_id=msg.campaign_id, prospect_id=msg.prospect_id)
            return {"ok": True, "matched": True}

    return r


def suppress(db: Session, workspace_id: int, email: str, reason: str) -> None:
    value = email.lower().strip()
    if not db.scalar(select(Suppression).where(Suppression.workspace_id == workspace_id, Suppression.value == value)):
        db.add(Suppression(workspace_id=workspace_id, value=value, kind="email", reason=reason))


def stop_prospect(db: Session, prospect_id: int, status: str) -> None:
    p = db.get(Prospect, prospect_id)
    if p is not None:
        p.status, p.updated_at = status, utcnow()
    for m in db.scalars(select(Message).where(Message.prospect_id == prospect_id,
                                              Message.status.in_(("needs_review", "approved", "scheduled")))):
        m.status, m.error = "cancelled", f"stopped: prospect {status}"


def _svix_ok(secret: str, headers, body: bytes) -> bool:
    sid, ts, sig = headers.get("svix-id"), headers.get("svix-timestamp"), headers.get("svix-signature")
    if not (sid and ts and sig):
        return False
    try:
        if abs(time.time() - int(ts)) > 300:
            return False
        key = base64.b64decode(secret.removeprefix("whsec_"))
    except ValueError:
        return False
    expected = base64.b64encode(hmac.new(key, f"{sid}.{ts}.".encode() + body, hashlib.sha256).digest()).decode()
    return any(hmac.compare_digest(expected, part.split(",", 1)[-1]) for part in sig.split())


def _page(title: str, text: str, form: str = "") -> HTMLResponse:
    return HTMLResponse(f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>{escape(title)}</title><style>
:root{{color-scheme:light dark}}body{{margin:0;min-height:100vh;display:grid;place-items:center;
font:16px/1.5 system-ui,sans-serif;background:radial-gradient(60% 50% at 50% 40%,#0b0f6b 0,#2433ff 35%,#5ec8f0 60%,#f6f5f2 85%);}}
main{{background:#fffffff2;color:#0b0c1a;padding:40px;border-radius:16px;max-width:420px;margin:16px;
box-shadow:0 20px 60px #0b0f6b33}}h1{{font:400 32px/1.1 Georgia,serif;margin:0 0 12px}}
button{{margin-top:16px;background:#2433ff;color:#fff;border:0;border-radius:10px;padding:12px 18px;font-size:15px;cursor:pointer}}
</style></head><body><main><h1>{escape(title)}</h1><p>{text}</p>{form}</main></body></html>""")


def _mount_frontend(app: FastAPI, cfg: ServerConfig) -> None:
    dist = cfg.frontend_dist
    index = dist / "index.html"
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "not found")
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        if index.is_file():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return HTMLResponse("<h1>outreach-os API is running</h1><p>Build the dashboard: "
                            "<code>cd frontend && npm install && npm run build</code></p>")
