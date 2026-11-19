"""Playbook CRUD, templates and generation from your own website."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from outreach.playbook import TEMPLATES, Playbook, from_template, validate_playbook
from outreach.server.db import Campaign, PlaybookRow, Workspace, utcnow
from outreach.server.deps import Caller, Services, caller, get_db, not_found, services
from outreach.server.serialize import playbook_dict, playbook_summary
from outreach.server.workspace import log_event

router = APIRouter(prefix="/api/playbooks")


def _get(db: Session, c: Caller, pid: int) -> PlaybookRow:
    row = db.get(PlaybookRow, pid)
    if row is None or row.workspace_id != c.ws.id:
        raise not_found("playbook not found")
    return row


class NewPlaybook(BaseModel):
    template: str = "sprinto"
    name: str | None = None


class GenerateIn(BaseModel):
    website: str


@router.get("")
def list_playbooks(c: Caller = Depends(caller), db: Session = Depends(get_db)):
    rows = db.scalars(select(PlaybookRow).where(PlaybookRow.workspace_id == c.ws.id).order_by(PlaybookRow.updated_at.desc()))
    return [playbook_summary(db, r) for r in rows]


@router.get("/templates")
def templates(c: Caller = Depends(caller)):
    return [{"key": k, "name": n, "description": d} for k, (n, d) in TEMPLATES.items()]


@router.post("")
def create(body: NewPlaybook, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    try:
        pb = from_template(body.template)
    except KeyError:
        raise HTTPException(422, "unknown template") from None
    if body.name and body.name.strip():
        pb.name = body.name.strip()[:160]
    row = PlaybookRow(workspace_id=c.ws.id, name=pb.name, template=pb.template, data=pb.model_dump(mode="json"))
    db.add(row)
    db.flush()
    return playbook_dict(row)


@router.post("/generate")
def generate(body: GenerateIn, c: Caller = Depends(caller), db: Session = Depends(get_db),
             svc: Services = Depends(services)):
    from outreach.cache import normalize_domain
    from outreach.generate import generate_playbook
    from outreach.server.pipeline import SystemicError, build_context

    ws = db.get(Workspace, c.ws.id)
    try:
        domain = normalize_domain(body.website)
    except ValueError:
        raise HTTPException(422, "enter your company website, e.g. acme.com") from None
    try:
        ctx = build_context(db, ws, None, from_template("blank"), svc.crypto, svc.cfg)
    except SystemicError as exc:
        raise HTTPException(422, str(exc)) from None
    try:
        pb = generate_playbook(ctx.llm, ctx.fetcher, model=ctx.settings.gemini_model_smart, website=domain)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"could not generate a playbook: {type(exc).__name__}") from None
    row = PlaybookRow(workspace_id=c.ws.id, name=pb.name, template=pb.template, data=pb.model_dump(mode="json"))
    db.add(row)
    db.flush()
    log_event(db, c.ws.id, "playbook", f"Playbook '{pb.name}' drafted from {domain}. Review it before use.")
    return playbook_dict(row)


@router.get("/{pid}")
def get_one(pid: int, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    return playbook_dict(_get(db, c, pid))


@router.put("/{pid}")
def update(pid: int, body: dict, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    row = _get(db, c, pid)
    data = {k: v for k, v in body.items() if k not in ("id", "version", "updated_at")}
    data.setdefault("template", row.template)
    try:
        pb = Playbook.model_validate(data)
    except ValidationError as exc:
        errors = [".".join(str(x) for x in e["loc"]) + ": " + e["msg"] for e in exc.errors()[:12]]
        raise HTTPException(422, {"detail": "the playbook is not valid", "errors": errors}) from None
    errors = validate_playbook(pb)
    if errors:
        raise HTTPException(422, {"detail": "the playbook is not valid", "errors": errors})
    row.data = pb.model_dump(mode="json")
    row.name = pb.name
    row.version += 1
    row.updated_at = utcnow()
    log_event(db, c.ws.id, "playbook", f"Playbook '{pb.name}' saved (version {row.version})")
    return playbook_dict(row)


@router.post("/{pid}/duplicate")
def duplicate(pid: int, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    row = _get(db, c, pid)
    data = dict(row.data)
    data["name"] = f"{row.name} (copy)"[:160]
    new = PlaybookRow(workspace_id=c.ws.id, name=data["name"], template=row.template, data=data)
    db.add(new)
    db.flush()
    return playbook_dict(new)


@router.delete("/{pid}")
def delete(pid: int, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    row = _get(db, c, pid)
    used = db.scalar(select(func.count()).select_from(Campaign).where(Campaign.playbook_id == pid)) or 0
    if used:
        raise HTTPException(409, f"{used} campaign(s) use this playbook")
    db.delete(row)
    return {"ok": True}
