"""The review queue, sent mail, analytics, the activity feed and the suppression list."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from outreach.playbook import Playbook
from outreach.server.db import Campaign, EventRow, Message, PlaybookRow, Prospect, Suppression, Workspace, utcnow
from outreach.server.deps import Caller, Services, caller, get_db, not_found, services
from outreach.server.mailer import next_send_slot
from outreach.server.pipeline import SystemicError, regenerate, revalidate
from outreach.server.serialize import event_dict, iso, message_dict
from outreach.server.workspace import log_event

router = APIRouter(prefix="/api")


def _msg(db: Session, c: Caller, mid: int) -> Message:
    m = db.get(Message, mid)
    if m is None or m.workspace_id != c.ws.id:
        raise not_found("message not found")
    return m


def _pb(db: Session, campaign: Campaign) -> Playbook | None:
    row = db.get(PlaybookRow, campaign.playbook_id)
    return Playbook.model_validate(row.data) if row else None


def _out(db: Session, m: Message, ws: Workspace, svc: Services) -> dict:
    campaign = db.get(Campaign, m.campaign_id)
    return message_dict(m, db.get(Prospect, m.prospect_id), campaign, ws, _pb(db, campaign), svc.cfg)


@router.get("/messages")
def list_messages(status: str | None = None, campaign_id: int | None = None, limit: int = 200,
                  c: Caller = Depends(caller), db: Session = Depends(get_db), svc: Services = Depends(services)):
    q = select(Message).where(Message.workspace_id == c.ws.id)
    if status:
        q = q.where(Message.status.in_(status.split(",")))
    if campaign_id:
        q = q.where(Message.campaign_id == campaign_id)
    msgs = list(db.scalars(q.order_by(Message.updated_at.desc(), Message.id.desc()).limit(min(limit, 500))))
    camps = {x.id: x for x in db.scalars(select(Campaign).where(Campaign.workspace_id == c.ws.id))}
    pbs: dict[int, Playbook | None] = {}
    prospects = {p.id: p for p in db.scalars(select(Prospect).where(Prospect.id.in_({m.prospect_id for m in msgs})))}
    out = []
    for m in msgs:
        camp = camps[m.campaign_id]
        if camp.playbook_id not in pbs:
            pbs[camp.playbook_id] = _pb(db, camp)
        out.append(message_dict(m, prospects[m.prospect_id], camp, c.ws, pbs[camp.playbook_id], svc.cfg))
    return out


@router.get("/messages/{mid}")
def get_message(mid: int, c: Caller = Depends(caller), db: Session = Depends(get_db), svc: Services = Depends(services)):
    return _out(db, _msg(db, c, mid), c.ws, svc)


class EditIn(BaseModel):
    subject: str | None = None
    body: str | None = None


@router.patch("/messages/{mid}")
def edit_message(mid: int, body: EditIn, c: Caller = Depends(caller), db: Session = Depends(get_db),
                 svc: Services = Depends(services)):
    m = _msg(db, c, mid)
    if m.status not in ("needs_review", "approved", "scheduled", "rejected", "failed"):
        raise HTTPException(409, f"a {m.status} message cannot be edited")
    if body.subject is not None:
        if m.step > 0:
            raise HTTPException(422, "follow-ups keep the first email's subject (they are sent in the same thread)")
        m.subject = body.subject.strip()[:300]
    if body.body is not None:
        m.body = body.body.strip()[:5000]
    campaign = db.get(Campaign, m.campaign_id)
    pb = _pb(db, campaign)
    if pb is not None:
        m.validation = revalidate(db, m, pb)
    if m.status in ("approved", "scheduled", "failed") and not m.validation.get("ok", True):
        m.status = "needs_review"
    m.updated_at = utcnow()
    return _out(db, m, c.ws, svc)


class ApproveIn(BaseModel):
    send_at: datetime | None = None
    force: bool = False


def _approve(db: Session, m: Message, ws: Workspace, user_name: str, send_at: datetime | None, force: bool) -> None:
    if m.status not in ("needs_review", "rejected", "failed"):
        raise HTTPException(409, f"a {m.status} message cannot be approved")
    if not (m.validation or {}).get("ok", True) and not force:
        raise HTTPException(409, {"detail": "this draft fails validation; fix it or approve anyway",
                                  "errors": list((m.validation or {}).get("failures") or [])})
    prospect = db.get(Prospect, m.prospect_id)
    if send_at is not None:
        when = send_at if send_at.tzinfo is None else send_at.astimezone(timezone.utc).replace(tzinfo=None)
        m.scheduled_at, m.status = max(when, utcnow()), "scheduled"
    else:
        slot = next_send_slot(ws)
        m.scheduled_at = slot
        m.status = "approved" if slot <= utcnow() + timedelta(minutes=1) else "scheduled"
    m.error = None
    m.updated_at = utcnow()
    if m.step == 0 and prospect.status in ("needs_review", "rejected_draft"):
        prospect.status = "approved"
        prospect.updated_at = utcnow()
    note = " (validation overridden)" if force and not (m.validation or {}).get("ok", True) else ""
    log_event(db, m.workspace_id, "approved",
              f"{prospect.domain}: {'first email' if m.step == 0 else f'follow-up {m.step}'} approved by {user_name}{note}",
              level="success", campaign_id=m.campaign_id, prospect_id=m.prospect_id)


@router.post("/messages/{mid}/approve")
def approve(mid: int, body: ApproveIn, c: Caller = Depends(caller), db: Session = Depends(get_db),
            svc: Services = Depends(services)):
    m = _msg(db, c, mid)
    _approve(db, m, c.ws, c.user.name, body.send_at, body.force)
    return _out(db, m, c.ws, svc)


class BulkIn(BaseModel):
    ids: list[int]


@router.post("/messages/bulk-approve")
def bulk_approve(body: BulkIn, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    approved = skipped = 0
    for mid in body.ids[:500]:
        m = db.get(Message, mid)
        if m is None or m.workspace_id != c.ws.id:
            continue
        try:
            _approve(db, m, c.ws, c.user.name, None, False)
            approved += 1
        except HTTPException:
            skipped += 1
    return {"approved": approved, "skipped": skipped}


@router.post("/messages/{mid}/reject")
def reject(mid: int, c: Caller = Depends(caller), db: Session = Depends(get_db), svc: Services = Depends(services)):
    m = _msg(db, c, mid)
    if m.status in ("sent", "sending"):
        raise HTTPException(409, "this message was already sent")
    m.status, m.updated_at = "rejected", utcnow()
    prospect = db.get(Prospect, m.prospect_id)
    if m.step == 0:
        prospect.status = "rejected_draft"
    log_event(db, c.ws.id, "rejected", f"{prospect.domain}: draft rejected by {c.user.name}", level="warning",
              campaign_id=m.campaign_id, prospect_id=m.prospect_id)
    return _out(db, m, c.ws, svc)


class RegenIn(BaseModel):
    instructions: str | None = None


@router.post("/messages/{mid}/regenerate")
def regen(mid: int, body: RegenIn, c: Caller = Depends(caller), db: Session = Depends(get_db),
          svc: Services = Depends(services)):
    m = _msg(db, c, mid)
    if m.status in ("sent", "sending"):
        raise HTTPException(409, "this message was already sent")
    try:
        regenerate(db, m, body.instructions, svc.crypto, svc.cfg)
    except SystemicError as exc:
        raise HTTPException(422, str(exc)) from None
    return _out(db, m, c.ws, svc)


@router.post("/messages/{mid}/mark-replied")
def mark_replied(mid: int, c: Caller = Depends(caller), db: Session = Depends(get_db),
                 svc: Services = Depends(services)):
    from outreach.server.app import stop_prospect

    m = _msg(db, c, mid)
    m.replied_at = utcnow()
    stop_prospect(db, m.prospect_id, "replied")
    prospect = db.get(Prospect, m.prospect_id)
    log_event(db, c.ws.id, "replied", f"{prospect.domain}: {m.to_name} replied. Sequence stopped.", level="success",
              campaign_id=m.campaign_id, prospect_id=m.prospect_id)
    return _out(db, m, c.ws, svc)


# --------------------------------------------------------------------------- analytics


@router.get("/analytics/overview")
def overview(campaign_id: int | None = None, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    pq = select(Prospect.status, Prospect.contact, Prospect.trail).where(Prospect.workspace_id == c.ws.id)
    mq = select(Message).where(Message.workspace_id == c.ws.id)
    if campaign_id:
        pq, mq = pq.where(Prospect.campaign_id == campaign_id), mq.where(Message.campaign_id == campaign_id)
    prospects = db.execute(pq).all()
    msgs = list(db.scalars(mq))
    statuses = Counter(s for s, _, _ in prospects)
    qualified = sum(1 for s, _, t in prospects
                    if ((t or {}).get("qualify") or {}).get("verdict") == "qualified"
                    or ((t or {}).get("qualify") or {}).get("manual_override"))
    contact = sum(1 for _, ct, _ in prospects if ct)
    first = [m for m in msgs if m.step == 0]
    drafted = len({m.prospect_id for m in first})
    sent_prospects = len({m.prospect_id for m in msgs if m.status == "sent" or m.sent_at})
    replied = statuses.get("replied", 0)
    bounced = statuses.get("bounced", 0)
    total = len(prospects)
    today = utcnow().date()
    days = [today - timedelta(days=i) for i in range(13, -1, -1)]
    sent_by = Counter(m.sent_at.date() for m in msgs if m.sent_at)
    replied_by = Counter(m.replied_at.date() for m in msgs if m.replied_at)
    needs_review = db.scalar(select(func.count()).select_from(Message).where(
        Message.workspace_id == c.ws.id, Message.status == "needs_review",
        *( [Message.campaign_id == campaign_id] if campaign_id else []))) or 0
    rate = lambda a, b: round(a / b, 4) if b else 0.0  # noqa: E731
    return {
        "funnel": [
            {"key": "added", "label": "Companies added", "count": total},
            {"key": "qualified", "label": "Qualified", "count": qualified},
            {"key": "contact_found", "label": "Decision-maker found", "count": contact},
            {"key": "drafted", "label": "Email drafted", "count": drafted},
            {"key": "sent", "label": "Sent", "count": sent_prospects},
            {"key": "replied", "label": "Replied", "count": replied},
        ],
        "outcomes": [{"key": k, "count": v} for k, v in statuses.most_common()],
        "sent_by_day": [{"date": d.isoformat(), "sent": sent_by.get(d, 0), "replied": replied_by.get(d, 0)} for d in days],
        "rates": {"qualification": rate(qualified, total - statuses.get("queued", 0) - statuses.get("researching", 0)),
                  "contact": rate(contact, qualified), "reply": rate(replied, sent_prospects),
                  "bounce": rate(bounced, sent_prospects)},
        "needs_review": needs_review,
        "hours_saved": round(drafted * 17.5 / 60, 1),
    }


@router.get("/activity")
def activity(limit: int = 50, prospect_id: int | None = None, campaign_id: int | None = None,
             c: Caller = Depends(caller), db: Session = Depends(get_db)):
    q = select(EventRow).where(EventRow.workspace_id == c.ws.id)
    if prospect_id:
        q = q.where(EventRow.prospect_id == prospect_id)
    if campaign_id:
        q = q.where(EventRow.campaign_id == campaign_id)
    return [event_dict(e) for e in db.scalars(q.order_by(EventRow.at.desc(), EventRow.id.desc()).limit(min(limit, 200)))]


# --------------------------------------------------------------------------- suppressions


class SuppressIn(BaseModel):
    value: str
    reason: str | None = None


@router.get("/suppressions")
def list_suppressions(c: Caller = Depends(caller), db: Session = Depends(get_db)):
    rows = db.scalars(select(Suppression).where(Suppression.workspace_id == c.ws.id).order_by(Suppression.created_at.desc()))
    return [{"id": s.id, "value": s.value, "kind": s.kind, "reason": s.reason, "created_at": iso(s.created_at)} for s in rows]


@router.post("/suppressions")
def add_suppression(body: SuppressIn, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    value = body.value.strip().lower().removeprefix("@")
    if not value or " " in value or "." not in value:
        raise HTTPException(422, "enter an email address or a domain")
    kind = "email" if "@" in value else "domain"
    existing = db.scalar(select(Suppression).where(Suppression.workspace_id == c.ws.id, Suppression.value == value))
    if existing is None:
        existing = Suppression(workspace_id=c.ws.id, value=value, kind=kind, reason=(body.reason or "added by hand")[:200])
        db.add(existing)
        db.flush()
    return {"id": existing.id, "value": existing.value, "kind": existing.kind, "reason": existing.reason,
            "created_at": iso(existing.created_at)}


@router.delete("/suppressions/{sid}")
def delete_suppression(sid: int, c: Caller = Depends(caller), db: Session = Depends(get_db)):
    s = db.get(Suppression, sid)
    if s is None or s.workspace_id != c.ws.id:
        raise not_found("not found")
    db.delete(s)
    return {"ok": True}
