"""Campaigns and their prospects."""

from __future__ import annotations

import csv
import io
import ipaddress
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from outreach.cache import normalize_domain
from outreach.server.db import Campaign, Message, PlaybookRow, Prospect, utcnow
from outreach.server.deps import Caller, Services, caller, get_db, not_found, services
from outreach.server.serialize import campaign_dict, campaign_stats, prospect_detail, prospect_row
from outreach.server.workspace import log_event

router = APIRouter(prefix="/api")

MAX_PER_ADD = 500
_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_BAD_TLDS = {"local", "localhost", "internal", "lan", "home", "corp", "intranet", "test", "invalid", "arpa"}
_EMAIL = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")


def parse_domain(raw: str) -> str:
    """A public company domain from any of 'acme.com', 'https://www.acme.com/x', 'ACME.COM '."""
    try:
        d = normalize_domain(raw)
    except ValueError:
        raise ValueError("not a domain") from None
    d = d.removeprefix("www.")
    try:
        ipaddress.ip_address(d)
        raise ValueError("IP addresses are not allowed")
    except ValueError as exc:
        if "IP addresses" in str(exc):
            raise
    labels = d.split(".")
    if len(labels) < 2 or not all(_LABEL.match(x) for x in labels) or len(d) > 253:
        raise ValueError("not a valid domain")
    if labels[-1] in _BAD_TLDS or labels[-1].isdigit():
        raise ValueError("not a public domain")
    return d


def parse_input(domains: list[str] | None, csv_text: str | None) -> tuple[list[tuple[str, dict | None]], list[dict]]:
    rows: list[tuple[str, dict | None]] = []
    rejected: list[dict] = []
    seen: set[str] = set()

    def add(raw: str, contact: dict | None):
        raw = (raw or "").strip()
        if not raw or raw.startswith("#"):
            return
        try:
            d = parse_domain(raw)
        except ValueError as exc:
            rejected.append({"input": raw[:200], "reason": str(exc)})
            return
        if d in seen:
            rejected.append({"input": raw[:200], "reason": "duplicate in this list"})
            return
        seen.add(d)
        rows.append((d, contact))

    for line in domains or []:
        for part in re.split(r"[\s,;]+", line):
            add(part, None)
    if csv_text and csv_text.strip():
        reader = csv.DictReader(io.StringIO(csv_text.strip()))
        fields = {(f or "").strip().lower(): f for f in (reader.fieldnames or [])}
        if "domain" not in fields and "website" not in fields:
            raise HTTPException(422, "the CSV needs a 'domain' column (optional: first_name, last_name, email, title)")
        col = fields.get("domain") or fields.get("website")
        for rec in reader:
            get = lambda k: (rec.get(fields.get(k, ""), "") or "").strip()  # noqa: E731
            contact = None
            if get("first_name") and get("email") and get("title"):
                if not _EMAIL.match(get("email")):
                    rejected.append({"input": get("email")[:200], "reason": "invalid contact email"})
                else:
                    contact = {"first_name": get("first_name"), "last_name": get("last_name") or None,
                               "email": get("email").lower(), "position": get("title")}
            add(rec.get(col, ""), contact)
    if len(rows) > MAX_PER_ADD:
        for d, _ in rows[MAX_PER_ADD:]:
            rejected.append({"input": d, "reason": f"over the {MAX_PER_ADD} per upload limit"})
        rows = rows[:MAX_PER_ADD]
    return rows, rejected


def _campaign(db: Session, c: Caller, cid: int) -> Campaign:
    camp = db.get(Campaign, cid)
    if camp is None or camp.workspace_id != c.ws.id:
        raise not_found("campaign not found")
    return camp


def _prospect(db: Session, c: Caller, pid: int) -> Prospect:
    p = db.get(Prospect, pid)
    if p is None or p.workspace_id != c.ws.id:
        raise not_found("prospect not found")
    return p


def _clean_followups(items) -> list[dict]:
    out = []
    for f in (items or [])[:3]:
        try:
            days = float(f.get("delay_days", 3))
        except (TypeError, ValueError, AttributeError):
            raise HTTPException(422, "follow-up delay_days must be a number") from None
        out.append({"delay_days": max(0.0, min(60.0, days))})
    return out


def _add(db: Session, ws_id: int, camp: Campaign, rows) -> tuple[int, list[dict]]:
    existing = set(db.scalars(select(Prospect.domain).where(Prospect.campaign_id == camp.id)))
    added, rejected = 0, []
    for domain, contact in rows:
        if domain in existing:
            rejected.append({"input": domain, "reason": "already in this campaign"})
            continue
        db.add(Prospect(workspace_id=ws_id, campaign_id=camp.id, domain=domain, manual_contact=contact,
                        status="queued", trail={}))
        existing.add(domain)
        added += 1
    return added, rejected


class NewCampaign(BaseModel):
    name: str
    playbook_id: int
    domains: list[str] | None = None
    csv: str | None = None
    auto_approve: bool = False
    followups: list[dict] = Field(default_factory=list)
    hunter_live: bool = False


class AddProspects(BaseModel):
    domains: list[str] | None = None
    csv: str | None = None


@router.get("/campaigns")
def list_campaigns(c: Caller = Depends(caller), db: Session = Depends(get_db)):
    camps = list(db.scalars(select(Campaign).where(Campaign.workspace_id == c.ws.id).order_by(Campaign.created_at.desc())))
    stats = campaign_stats(db, [x.id for x in camps])
    pbs = {r.id: r for r in db.scalars(select(PlaybookRow).where(PlaybookRow.workspace_id == c.ws.id))}
    return [campaign_dict(x, pbs.get(x.playbook_id), stats[x.id]) for x in camps]


@router.post("/campaigns")
def create_campaign(body: NewCampaign, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    if not body.name.strip():
        raise HTTPException(422, "give the campaign a name")
    pb = db.get(PlaybookRow, body.playbook_id)
    if pb is None or pb.workspace_id != c.ws.id:
        raise HTTPException(422, "choose a playbook")
    rows, rejected = parse_input(body.domains, body.csv)
    if not rows:
        raise HTTPException(422, {"detail": "add at least one valid company domain",
                                  "errors": [f"{r['input']}: {r['reason']}" for r in rejected][:20]})
    camp = Campaign(workspace_id=c.ws.id, playbook_id=pb.id, name=body.name.strip()[:160],
                    auto_approve=body.auto_approve, hunter_live=body.hunter_live,
                    followups=_clean_followups(body.followups), status="running")
    db.add(camp)
    db.flush()
    added, dupes = _add(db, c.ws.id, camp, rows)
    log_event(db, c.ws.id, "campaign_created", f"Campaign '{camp.name}' created with {added} companies",
              level="success", campaign_id=camp.id)
    db.flush()
    return {**campaign_dict(camp, pb, campaign_stats(db, [camp.id])[camp.id]), "rejected": rejected + dupes}


@router.get("/campaigns/{cid}")
def get_campaign(cid: int, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    camp = _campaign(db, c, cid)
    return campaign_dict(camp, db.get(PlaybookRow, camp.playbook_id), campaign_stats(db, [cid])[cid])


@router.patch("/campaigns/{cid}")
def patch_campaign(cid: int, body: dict, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    camp = _campaign(db, c, cid)
    if "name" in body and str(body["name"]).strip():
        camp.name = str(body["name"]).strip()[:160]
    if "status" in body:
        if body["status"] not in ("running", "paused"):
            raise HTTPException(422, "status must be running or paused")
        if camp.status != body["status"]:
            camp.status = body["status"]
            log_event(db, c.ws.id, "campaign", f"Campaign '{camp.name}' {'resumed' if camp.status == 'running' else 'paused'}",
                      campaign_id=cid)
            if camp.status == "running":  # failed-by-setup prospects get another chance
                for p in db.scalars(select(Prospect).where(Prospect.campaign_id == cid, Prospect.status == "queued")):
                    p.error = None
    if "auto_approve" in body:
        camp.auto_approve = bool(body["auto_approve"])
    if "followups" in body:
        camp.followups = _clean_followups(body["followups"])
    if "hunter_live" in body:
        camp.hunter_live = bool(body["hunter_live"])
    return campaign_dict(camp, db.get(PlaybookRow, camp.playbook_id), campaign_stats(db, [cid])[cid])


@router.delete("/campaigns/{cid}")
def delete_campaign(cid: int, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    camp = _campaign(db, c, cid)
    for m in db.scalars(select(Message).where(Message.campaign_id == cid)):
        db.delete(m)
    for p in db.scalars(select(Prospect).where(Prospect.campaign_id == cid)):
        db.delete(p)
    db.delete(camp)
    return {"ok": True}


@router.post("/campaigns/{cid}/prospects")
def add_prospects(cid: int, body: AddProspects, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    camp = _campaign(db, c, cid)
    rows, rejected = parse_input(body.domains, body.csv)
    added, dupes = _add(db, c.ws.id, camp, rows)
    if added:
        log_event(db, c.ws.id, "prospects_added", f"{added} companies added to '{camp.name}'", campaign_id=cid)
    return {"added": added, "rejected": rejected + dupes}


@router.get("/campaigns/{cid}/prospects")
def list_prospects(cid: int, status: str | None = None, q: str | None = None, c: Caller = Depends(caller),
                   db: Session = Depends(get_db)):
    camp = _campaign(db, c, cid)
    query = select(Prospect).where(Prospect.campaign_id == cid)
    if status:
        query = query.where(Prospect.status.in_(status.split(",")))
    if q:
        like = f"%{q.strip().lower()}%"
        query = query.where(or_(Prospect.domain.ilike(like), Prospect.company_name.ilike(like)))
    prospects = list(db.scalars(query.order_by(Prospect.id)))
    msgs: dict[int, list] = {}
    for m in db.scalars(select(Message).where(Message.campaign_id == cid).order_by(Message.step)):
        msgs.setdefault(m.prospect_id, []).append(m)
    return [prospect_row(p, msgs.get(p.id, []), camp) for p in prospects]


def _cell(value) -> str:
    """Neutralise spreadsheet formulas: company names and titles come from scraped pages."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@router.get("/campaigns/{cid}/export.csv")
def export_csv(cid: int, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    camp = _campaign(db, c, cid)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["domain", "company", "status", "score_min", "score_max", "summary", "contact_name", "contact_title",
                "contact_email", "first_email_subject", "first_email_status", "sent_at"])
    firsts = {m.prospect_id: m for m in db.scalars(select(Message).where(Message.campaign_id == cid, Message.step == 0))}
    for p in db.scalars(select(Prospect).where(Prospect.campaign_id == cid).order_by(Prospect.id)):
        m = firsts.get(p.id)
        ct = p.contact or {}
        w.writerow([_cell(v) for v in (
            p.domain, p.company_name, p.status, p.score_min, p.score_max, p.summary, ct.get("name"),
            ct.get("title"), ct.get("email"), m.subject if m else "", m.status if m else "",
            m.sent_at.isoformat() if m and m.sent_at else "")])
    name = re.sub(r"[^a-z0-9]+", "-", camp.name.lower()).strip("-") or "campaign"
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})


# --------------------------------------------------------------------------- prospects


@router.get("/prospects/{pid}")
def get_prospect(pid: int, c: Caller = Depends(caller), db: Session = Depends(get_db),
                 svc: Services = Depends(services)):
    return prospect_detail(db, _prospect(db, c, pid), c.ws, svc.cfg)


def _requeue(db: Session, p: Prospect, keep: tuple[str, ...]) -> None:
    trail = {k: v for k, v in (p.trail or {}).items() if k in keep}
    p.trail = trail
    p.status, p.stage, p.error, p.attempts, p.run_after, p.lease_until = "queued", None, None, 0, None, None
    p.updated_at = utcnow()
    for m in db.scalars(select(Message).where(Message.prospect_id == p.id,
                                              Message.status.in_(("needs_review", "approved", "scheduled", "rejected")))):
        db.delete(m)


@router.post("/prospects/{pid}/rerun")
def rerun(pid: int, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    p = _prospect(db, c, pid)
    if p.status in ("sent", "replied", "unsubscribed", "bounced"):
        raise HTTPException(409, f"this prospect is already {p.status}")
    _requeue(db, p, keep=())
    p.override, p.contact, p.score_min, p.score_max, p.score_expected, p.summary = False, None, None, None, None, None
    log_event(db, c.ws.id, "rerun", f"{p.domain}: rerun requested", campaign_id=p.campaign_id, prospect_id=p.id)
    return prospect_row(p)


@router.post("/prospects/{pid}/override")
def override(pid: int, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    p = _prospect(db, c, pid)
    if p.status != "insufficient_data" or not (p.trail or {}).get("qualify"):
        raise HTTPException(409, "only a prospect stopped as 'not enough data' after scoring can be overridden")
    p.override = True
    _requeue(db, p, keep=("scrape", "extract"))
    log_event(db, c.ws.id, "override", f"{p.domain}: continued past the gray band by {c.user.name} (manual override)",
              level="warning", campaign_id=p.campaign_id, prospect_id=p.id)
    return prospect_row(p)


class ContactIn(BaseModel):
    first_name: str
    last_name: str | None = None
    email: str
    title: str


@router.put("/prospects/{pid}/contact")
def set_contact(pid: int, body: ContactIn, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    p = _prospect(db, c, pid)
    if not body.first_name.strip() or not body.title.strip() or not _EMAIL.match(body.email.strip()):
        raise HTTPException(422, "first name, title and a valid email are required")
    if p.status in ("sent", "replied", "unsubscribed", "bounced"):
        raise HTTPException(409, f"this prospect is already {p.status}")
    p.manual_contact = {"first_name": body.first_name.strip(), "last_name": (body.last_name or "").strip() or None,
                        "email": body.email.strip().lower(), "position": body.title.strip()}
    qualified = ((p.trail or {}).get("qualify") or {}).get("verdict") == "qualified" or \
        ((p.trail or {}).get("qualify") or {}).get("manual_override")
    if qualified:
        _requeue(db, p, keep=("scrape", "extract", "qualify"))
    elif p.status not in ("queued", "researching"):
        _requeue(db, p, keep=())
    log_event(db, c.ws.id, "contact", f"{p.domain}: contact set by hand to {body.first_name} ({body.title})",
              campaign_id=p.campaign_id, prospect_id=p.id)
    return prospect_row(p)


@router.delete("/prospects/{pid}")
def delete_prospect(pid: int, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    p = _prospect(db, c, pid)
    for m in db.scalars(select(Message).where(Message.prospect_id == pid)):
        db.delete(m)
    db.delete(p)
    return {"ok": True}
