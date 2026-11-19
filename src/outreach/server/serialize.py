"""Database rows -> the JSON shapes in docs/API.md."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from outreach.playbook import Playbook
from outreach.server.config import ServerConfig
from outreach.server.db import Campaign, EventRow, Message, PlaybookRow, Prospect, Workspace
from outreach.server.mailer import footer, live_ready
from outreach.server.security import Crypto
from outreach.server.workspace import SECRET_NAMES, get_secret, hint, hunter_usage, secret_source, settings_of


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") + "Z" if dt else None


# --------------------------------------------------------------------------- settings


def settings_dict(ws: Workspace, crypto: Crypto, cfg: ServerConfig) -> dict:
    st = settings_of(ws)

    def integ(*names: str) -> dict:
        configured = all(get_secret(ws, n, crypto, cfg) for n in names)
        source = secret_source(ws, names[0], cfg)
        return {"configured": configured, "source": source if configured else None,
                "hint": hint(get_secret(ws, names[0], crypto, cfg), names[0]) if configured else None}

    missing = live_ready(ws, crypto, cfg)
    return {
        "workspace_name": ws.name,
        "demo_mode": ws.demo_mode,
        "onboarded": ws.onboarded,
        "sending": st["sending"],
        "models": st["models"],
        "integrations": {
            "gemini": integ("gemini_api_key"),
            "hunter": integ("hunter_api_key"),
            "resend": integ("resend_api_key"),
            "gmail": integ("gmail_user", "gmail_app_password"),
        },
        "hunter_usage": hunter_usage(ws),
        "live_ready": {"ok": not missing, "missing": missing},
        "webhook_url": f"{cfg.public_base_url}/api/webhooks/resend/{ws.id}",
        "live_data_available": bool(get_secret(ws, "gemini_api_key", crypto, cfg)),
        "limits": {"real_companies_per_workspace_per_day": cfg.open_max_domains,
                   "real_companies_per_site_per_day": cfg.open_max_prospects} if cfg.open_access else None,
    }


assert SECRET_NAMES  # imported for callers


# --------------------------------------------------------------------------- playbooks


def playbook_dict(row: PlaybookRow) -> dict:
    return {**row.data, "id": row.id, "name": row.name, "version": row.version, "template": row.template,
            "updated_at": iso(row.updated_at)}


def playbook_summary(db: Session, row: PlaybookRow) -> dict:
    count = db.scalar(select(func.count()).select_from(Campaign).where(Campaign.playbook_id == row.id)) or 0
    return {"id": row.id, "name": row.name, "product_name": row.data.get("product", {}).get("name", ""),
            "template": row.template, "version": row.version, "updated_at": iso(row.updated_at),
            "campaign_count": count}


# --------------------------------------------------------------------------- campaigns

STAT_KEYS = ("queued", "researching", "disqualified", "insufficient_data", "no_contact", "needs_review",
             "approved", "sent", "replied", "bounced", "failed")


def campaign_stats(db: Session, campaign_ids: list[int]) -> dict[int, dict]:
    out = {cid: {k: 0 for k in ("total", "qualified", *STAT_KEYS)} for cid in campaign_ids}
    if not campaign_ids:
        return out
    rows = db.execute(select(Prospect.campaign_id, Prospect.status, func.count())
                      .where(Prospect.campaign_id.in_(campaign_ids)).group_by(Prospect.campaign_id, Prospect.status))
    qualified_states = {"no_contact", "needs_review", "approved", "sent", "replied", "bounced", "rejected_draft",
                        "unsubscribed", "completed"}
    for cid, status, n in rows:
        s = out[cid]
        s["total"] += n
        if status in s:
            s[status] += n
        if status == "rejected_draft":
            s["needs_review"] += n
        if status in qualified_states:
            s["qualified"] += n
    # a prospect is "researching" past qualify too; count researching prospects that qualified
    q = db.execute(select(Prospect.campaign_id, Prospect.trail).where(
        Prospect.campaign_id.in_(campaign_ids), Prospect.status == "researching"))
    for cid, trail in q:
        if (trail or {}).get("qualify", {}).get("verdict") == "qualified" or (trail or {}).get("qualify", {}).get("manual_override"):
            out[cid]["qualified"] += 1
    return out


def campaign_dict(c: Campaign, pb: PlaybookRow | None, stats: dict) -> dict:
    return {"id": c.id, "name": c.name, "status": c.status,
            "playbook": {"id": c.playbook_id, "name": pb.name if pb else "(deleted)"},
            "auto_approve": c.auto_approve, "hunter_live": c.hunter_live, "followups": c.followups or [],
            "created_at": iso(c.created_at), "stats": stats}


# --------------------------------------------------------------------------- prospects


def _next_step(p: Prospect, msgs: list[Message], campaign: Campaign | None) -> str | None:
    st = p.status
    if st == "queued":
        return "Waiting to start"
    if st == "researching":
        labels = {"scrape": "Reading the website", "extract": "Extracting facts", "qualify": "Scoring against the ICP",
                  "poc": "Finding the decision-maker", "draft": "Writing the email"}
        return labels.get(p.stage or "", "Researching")
    if st == "needs_review":
        return "Review the draft"
    if st == "rejected_draft":
        return "Fix or regenerate the draft"
    if st == "insufficient_data":
        return "Override to continue, or skip"
    if st == "no_contact":
        return "Add a contact"
    if st == "approved":
        sched = next((m for m in msgs if m.status in ("approved", "scheduled")), None)
        return f"Sending {sched.scheduled_at:%b %d %H:%M} UTC" if sched and sched.scheduled_at else "Sending soon"
    if st == "sent":
        pending_msg = next((m for m in msgs if m.status in ("needs_review",)), None)
        if pending_msg:
            return f"Review follow-up {pending_msg.step}"
        steps = (campaign.followups or []) if campaign else []
        sent = [m for m in msgs if m.status == "sent"]
        if sent and len(sent) <= len(steps):
            from datetime import timedelta

            due = sent[-1].sent_at + timedelta(days=float(steps[len(sent) - 1].get("delay_days", 3)))
            return f"Follow-up {len(sent)} on {due:%b %d}"
        return "Sequence finished"
    if st == "failed":
        return "Rerun"
    return None


def prospect_row(p: Prospect, msgs: list[Message] | None = None, campaign: Campaign | None = None) -> dict:
    score = None
    if p.score_min is not None:
        score = {"min": p.score_min, "max": p.score_max, "expected": p.score_expected}
    contact = None
    if p.contact:
        contact = {k: p.contact.get(k) for k in ("name", "title", "email", "source")}
    return {"id": p.id, "campaign_id": p.campaign_id, "domain": p.domain, "company_name": p.company_name,
            "status": p.status, "stage": p.stage, "score": score, "contact": contact,
            "next_step": _next_step(p, msgs or [], campaign), "error": p.error, "updated_at": iso(p.updated_at)}


def _public_trail(trail: dict) -> dict:
    t = trail or {}
    scrape = t.get("scrape")
    if scrape:
        scrape = {**scrape, "pages": [{k: pg.get(k) for k in ("url", "status", "kind", "chars", "reason", "error")}
                                      for pg in scrape.get("pages", [])]}
    extract = t.get("extract")
    if extract:
        extract = {k: extract.get(k) for k in ("profile", "evidence_total", "evidence_kept", "evidence_dropped",
                                               "injection_suspected_pages", "pages_used")}
    draft = t.get("draft")
    if draft:
        draft = {k: draft.get(k) for k in ("pain_points", "pain_points_source", "evidence_pack", "hook_map",
                                           "validation", "claims_used", "learned_from")}
    return {"scrape": scrape, "extract": extract, "qualify": t.get("qualify"), "poc": t.get("poc"), "draft": draft,
            "stop": t.get("stop")}


def event_dict(e: EventRow) -> dict:
    return {"id": e.id, "at": iso(e.at), "kind": e.kind, "message": e.message, "prospect_id": e.prospect_id,
            "campaign_id": e.campaign_id, "level": e.level}


def message_dict(m: Message, prospect: Prospect, campaign: Campaign, ws: Workspace, pb: Playbook | None,
                 cfg: ServerConfig) -> dict:
    return {
        "id": m.id, "prospect_id": m.prospect_id, "campaign": {"id": campaign.id, "name": campaign.name},
        "company": {"domain": prospect.domain, "name": prospect.company_name}, "step": m.step,
        "to": {"name": m.to_name, "email": m.to_email, "title": m.to_title}, "delivered_to": m.delivered_to,
        "subject": m.subject, "body": m.body, "footer": footer(ws, m, pb, cfg), "status": m.status,
        "validation": m.validation or {"ok": True, "failures": []}, "hook_map": m.hook_map or [],
        "pain_points": m.pain_points or [], "scheduled_at": iso(m.scheduled_at), "sent_at": iso(m.sent_at),
        "provider_id": m.provider_id, "error": m.error, "created_at": iso(m.created_at), "mode": m.mode,
    }


def _learned_from(db: Session, p: Prospect) -> list[dict]:
    """The winning emails (good replies) shown to the writer when this draft was made."""
    from outreach.server.db import WinRow

    ids = (((p.trail or {}).get("draft") or {}).get("learned_from")) or []
    if not ids:
        return []
    rows = db.scalars(select(WinRow).where(WinRow.id.in_(ids), WinRow.workspace_id == p.workspace_id))
    return [{"id": w.id, "subject": w.subject, "persona": w.persona, "company": w.company} for w in rows]


def prospect_detail(db: Session, p: Prospect, ws: Workspace, cfg: ServerConfig) -> dict:
    campaign = db.get(Campaign, p.campaign_id)
    pb_row = db.get(PlaybookRow, campaign.playbook_id)
    pb = Playbook.model_validate(pb_row.data) if pb_row else None
    msgs = list(db.scalars(select(Message).where(Message.prospect_id == p.id).order_by(Message.step, Message.id)))
    events = list(db.scalars(select(EventRow).where(EventRow.prospect_id == p.id).order_by(EventRow.at.desc()).limit(100)))
    return {
        **prospect_row(p, msgs, campaign),
        "summary": p.summary,
        "trail": _public_trail(p.trail),
        "learned_from": _learned_from(db, p),
        "messages": [message_dict(m, p, campaign, ws, pb, cfg) for m in msgs],
        "events": [event_dict(e) for e in events],
        "playbook": {"id": campaign.playbook_id, "name": pb_row.name if pb_row else None,
                     "version": p.playbook_version},
    }
