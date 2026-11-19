"""Background work as short, idempotent ticks.

A tick leases one unit of work at a time (a prospect stage, a due email, a due follow-up), does
it, and commits. The same `tick` runs in three places: a thread inside a long-running server,
`POST /api/worker/tick` (the open dashboard pumps it on serverless hosts) and
`GET /api/cron/tick` (a scheduler such as Vercel Cron). Leases make concurrent ticks safe.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import timedelta

from sqlalchemy import and_, func, or_, select, update

from outreach.server.config import ServerConfig
from outreach.server.db import Campaign, Database, Message, Prospect, Workspace, utcnow
from outreach.server.mailer import send_message
from outreach.server.pipeline import ACTIVE, SystemicError, advance, create_followup
from outreach.server.security import Crypto
from outreach.server.workspace import log_event

log = logging.getLogger("outreach.worker")
LEASE = timedelta(minutes=4)


def _ws_filter(col, workspace_id):
    return col == workspace_id if workspace_id is not None else True


def _claim_prospect(db, workspace_id) -> int | None:
    now = utcnow()
    q = (
        select(Prospect.id)
        .join(Campaign, Campaign.id == Prospect.campaign_id)
        .where(
            Prospect.status.in_(ACTIVE),
            Campaign.status == "running",
            _ws_filter(Prospect.workspace_id, workspace_id),
            or_(Prospect.run_after.is_(None), Prospect.run_after <= now),
            or_(Prospect.lease_until.is_(None), Prospect.lease_until < now),
        )
        .order_by(Prospect.status.desc(), Prospect.updated_at)  # finish "researching" before starting "queued"
        .limit(5)
    )
    for pid in db.scalars(q).all():
        res = db.execute(
            update(Prospect)
            .where(Prospect.id == pid, or_(Prospect.lease_until.is_(None), Prospect.lease_until < now))
            .values(lease_until=now + LEASE)
        )
        if res.rowcount == 1:
            db.commit()
            return pid
    return None


def _due_message(db, workspace_id) -> int | None:
    now = utcnow()
    q = (
        select(Message.id)
        .join(Campaign, Campaign.id == Message.campaign_id)
        .where(
            Campaign.status == "running",
            _ws_filter(Message.workspace_id, workspace_id),
            or_(Message.status == "approved",
                and_(Message.status == "scheduled", Message.scheduled_at <= now)),
            or_(Message.scheduled_at.is_(None), Message.scheduled_at <= now),
        )
        .order_by(Message.scheduled_at, Message.id)
        .limit(5)
    )
    for mid in db.scalars(q).all():
        res = db.execute(update(Message).where(Message.id == mid, Message.status.in_(("approved", "scheduled")))
                         .values(status="sending"))
        if res.rowcount == 1:
            db.commit()
            return mid
    return None


def _due_followup(db, workspace_id) -> tuple[int, int] | None:
    """(prospect id, step) for the next follow-up whose delay has passed."""
    q = (
        select(Prospect, Campaign)
        .join(Campaign, Campaign.id == Prospect.campaign_id)
        .where(Prospect.status == "sent", Campaign.status == "running", _ws_filter(Prospect.workspace_id, workspace_id),
               or_(Prospect.lease_until.is_(None), Prospect.lease_until < utcnow()))
        .limit(200)
    )
    now = utcnow()
    for prospect, campaign in db.execute(q).all():
        steps = campaign.followups or []
        msgs = list(db.scalars(select(Message).where(Message.prospect_id == prospect.id).order_by(Message.step)))
        if not msgs or len(msgs) > len(steps):
            continue
        last = msgs[-1]
        if last.status != "sent" or last.sent_at is None:
            continue
        step = last.step + 1
        if step > len(steps):
            continue
        delay = float(steps[step - 1].get("delay_days", 3))
        if last.sent_at + timedelta(days=delay) <= now:
            return prospect.id, step
    return None


def tick(database: Database, crypto: Crypto, cfg: ServerConfig, *, workspace_id: int | None = None,
         budget_s: float = 20.0) -> dict:
    start = time.monotonic()
    processed = 0
    while time.monotonic() - start < budget_s:
        did = False
        with database.session() as db:
            pid = _claim_prospect(db, workspace_id)
            if pid is not None:
                did = True
                p = db.get(Prospect, pid)
                try:
                    advance(db, p, crypto, cfg)
                except SystemicError as exc:
                    _systemic(db, p, str(exc))
                except Exception as exc:  # noqa: BLE001  (never retry a broken prospect forever)
                    log.exception("advance failed")
                    p.status, p.stage, p.error = "failed", None, f"internal error: {type(exc).__name__}"
                    log_event(db, p.workspace_id, "failed", f"{p.domain}: internal error ({type(exc).__name__})",
                              level="error", campaign_id=p.campaign_id, prospect_id=p.id)
                finally:
                    p.lease_until = None
        if not did:
            with database.session() as db:
                mid = _due_message(db, workspace_id)
                if mid is not None:
                    did = True
                    msg = db.get(Message, mid)
                    send_message(db, msg, crypto, cfg)
                    if msg.status == "sending":  # defensive: never leave a message stuck
                        msg.status = "failed"
        if not did:
            with database.session() as db:
                due = _due_followup(db, workspace_id)
                if due is not None:
                    did = True
                    p = db.get(Prospect, due[0])
                    try:
                        create_followup(db, p, db.get(Campaign, p.campaign_id), due[1], crypto, cfg)
                    except SystemicError as exc:
                        _systemic(db, p, str(exc), keep_status=True)
                    except Exception as exc:  # noqa: BLE001
                        log.exception("follow-up failed")
                        log_event(db, p.workspace_id, "followup_failed", f"{p.domain}: {type(exc).__name__}",
                                  level="error", campaign_id=p.campaign_id, prospect_id=p.id)
                        p.lease_until = utcnow() + timedelta(hours=1)
        if not did:
            break
        processed += 1
    with database.session() as db:
        return {"processed": processed, "pending": pending(db, workspace_id)}


def _systemic(db, prospect: Prospect, message: str, *, keep_status: bool = False) -> None:
    """A setup problem: pause the campaign so it does not burn through every prospect."""
    campaign = db.get(Campaign, prospect.campaign_id)
    if campaign.status == "running":
        campaign.status = "paused"
        log_event(db, prospect.workspace_id, "campaign_paused",
                  f"Campaign '{campaign.name}' paused: {message}", level="error", campaign_id=campaign.id)
    if not keep_status:
        prospect.status = "queued"
        prospect.error = message
        prospect.stage = None


def pending(db, workspace_id: int | None) -> int:
    now = utcnow()
    n = db.scalar(
        select(func.count()).select_from(Prospect).join(Campaign, Campaign.id == Prospect.campaign_id)
        .where(Prospect.status.in_(ACTIVE), Campaign.status == "running", _ws_filter(Prospect.workspace_id, workspace_id))
    ) or 0
    n += db.scalar(
        select(func.count()).select_from(Message).join(Campaign, Campaign.id == Message.campaign_id)
        .where(Campaign.status == "running", _ws_filter(Message.workspace_id, workspace_id),
               or_(Message.status == "approved", and_(Message.status == "scheduled", Message.scheduled_at <= now)))
    ) or 0
    return int(n)


class BackgroundWorker:
    """A daemon thread that ticks for every workspace (long-running hosts only)."""

    def __init__(self, database: Database, crypto: Crypto, cfg: ServerConfig):
        self.database, self.crypto, self.cfg = database, crypto, cfg
        self._stop = threading.Event()
        self.thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self.thread is not None and self.thread.is_alive()

    def start(self) -> None:
        if self.running:
            return
        self.thread = threading.Thread(target=self._loop, name="outreach-worker", daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                result = tick(self.database, self.crypto, self.cfg, budget_s=30)
                idle = result["processed"] == 0
            except Exception:  # noqa: BLE001
                log.exception("worker tick failed")
                idle = True
            self._stop.wait(self.cfg.worker_interval_s if idle else 0.05)


def workspace_ids(database: Database) -> list[int]:
    with database.session() as db:
        return list(db.scalars(select(Workspace.id)))
