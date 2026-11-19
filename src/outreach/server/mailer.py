"""The only place mail leaves the app.

Modes:
- demo: nothing is sent; the message is marked sent so the whole flow can be tried.
- test (default): every email goes to the workspace owner_email. The real recipient is named in
  the subject tag `[TEST -> Name <email>]`, so you see exactly what they would get.
- live: the email goes to the prospect. Allowed only once a provider, a from address and a
  physical postal address are configured; suppressed addresses and domains are never mailed.

Every email carries a footer with the sender identity, postal address and an unsubscribe link,
plus RFC 8058 one-click List-Unsubscribe headers. Follow-ups thread under the first email.
"""

from __future__ import annotations

import smtplib
import ssl
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from outreach.config import redact
from outreach.playbook import Playbook
from outreach.server.config import ServerConfig
from outreach.server.db import Campaign, Message, PlaybookRow, Prospect, Suppression, Workspace, utcnow
from outreach.server.security import Crypto
from outreach.server.workspace import get_secret, log_event, secret_source, settings_of


class SendRefused(Exception):
    pass


def uses_owner_mail(ws: Workspace, provider: str | None, cfg: ServerConfig) -> bool:
    """On a no-sign-in site, is this workspace about to send through the site owner's email account?"""
    if not cfg.open_access or provider not in ("gmail", "resend"):
        return False
    name = "gmail_app_password" if provider == "gmail" else "resend_api_key"
    return secret_source(ws, name, cfg) == "env"


def live_ready(ws: Workspace, crypto: Crypto, cfg: ServerConfig) -> list[str]:
    s = settings_of(ws)["sending"]
    missing = []
    provider = s.get("provider")
    if uses_owner_mail(ws, provider, cfg):
        missing.append("Your own Gmail or Resend account (the site's shared one only sends test emails)")
    if provider == "gmail":
        if not get_secret(ws, "gmail_user", crypto, cfg) or not get_secret(ws, "gmail_app_password", crypto, cfg):
            missing.append("Gmail address and app password")
    elif provider == "resend":
        if not get_secret(ws, "resend_api_key", crypto, cfg):
            missing.append("Resend API key")
        if not s.get("from_email"):
            missing.append("From address on a domain verified in Resend")
    else:
        missing.append("An email provider (Gmail or Resend)")
    if not (s.get("physical_address") or "").strip():
        missing.append("A physical postal address (required by CAN-SPAM)")
    if not (s.get("from_name") or "").strip():
        missing.append("A sender name")
    return missing


def footer(ws: Workspace, msg: Message, pb: Playbook | None, cfg: ServerConfig) -> str:
    s = settings_of(ws)["sending"]
    name = (s.get("from_name") or (pb.email.sender_name if pb else "") or "").strip() or "[Sender name]"
    title = pb.email.sender_title.strip() if pb and pb.email.sender_title.strip() not in ("", "[Title]") else ""
    product = pb.product.name if pb else ""
    identity = ", ".join(p for p in (name, title, product) if p)
    address = (s.get("physical_address") or "").strip() or "[Postal address: add it in Settings > Sending]"
    return (
        f"--\n{identity}\n{address}\n"
        f"Not the right person, or not interested? Unsubscribe: {cfg.public_base_url}/u/{msg.unsubscribe_token}"
    )


def _tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def next_send_slot(ws: Workspace, after: datetime | None = None) -> datetime:
    """The first moment at or after `after` (naive UTC) inside the workspace send window."""
    w = settings_of(ws)["sending"]["send_window"]
    tz = _tz(w.get("timezone", "UTC"))
    start_h, end_h = int(w.get("start_hour", 9)), int(w.get("end_hour", 17))
    weekdays = bool(w.get("weekdays_only", True))
    t = (after or utcnow()).replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
    for _ in range(14):
        ok_day = not weekdays or t.weekday() < 5
        if ok_day and start_h <= t.hour < end_h:
            return t.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
        if ok_day and t.hour < start_h:
            t = t.replace(hour=start_h, minute=0, second=0, microsecond=0)
            continue
        t = (t + timedelta(days=1)).replace(hour=start_h, minute=0, second=0, microsecond=0)
    return (after or utcnow())


def _suppressed(db: Session, ws_id: int, email: str) -> bool:
    email = email.lower().strip()
    domain = email.split("@")[-1]
    return db.scalar(select(func.count()).select_from(Suppression).where(
        Suppression.workspace_id == ws_id, Suppression.value.in_((email, domain)))) > 0


def sent_today(db: Session, ws_id: int) -> int:
    start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return db.scalar(select(func.count()).select_from(Message).where(
        Message.workspace_id == ws_id, Message.sent_at >= start, Message.mode != "demo")) or 0


def send_message(db: Session, msg: Message, crypto: Crypto, cfg: ServerConfig, *, sender=None) -> None:
    """Send one approved message now, or reschedule it. Never raises for per-message problems."""
    ws = db.get(Workspace, msg.workspace_id)
    prospect = db.get(Prospect, msg.prospect_id)
    campaign = db.get(Campaign, msg.campaign_id)
    pb_row = db.get(PlaybookRow, campaign.playbook_id)
    pb = Playbook.model_validate(pb_row.data) if pb_row else None
    s = settings_of(ws)["sending"]

    if prospect.status in ("replied", "unsubscribed", "bounced") or _suppressed(db, ws.id, msg.to_email):
        msg.status, msg.error = "cancelled", f"not sent: prospect is {prospect.status}" if prospect.status in (
            "replied", "unsubscribed", "bounced") else "not sent: address or domain is on the suppression list"
        msg.updated_at = utcnow()
        return

    if ws.demo_mode:
        _mark_sent(db, msg, prospect, mode="demo", to="demo mode: not sent", provider_id=f"demo-{msg.id}",
                   header=make_msgid(domain="demo.outreach-os"))
        return

    mode = s.get("mode", "test")
    if mode == "live":
        missing = live_ready(ws, crypto, cfg)
        if missing:
            _fail(db, msg, "live sending is not set up: " + "; ".join(missing))
            return
    if sent_today(db, ws.id) >= int(s.get("daily_cap", 30)):
        msg.scheduled_at = next_send_slot(ws, utcnow().replace(hour=0, minute=0) + timedelta(days=1))
        msg.status = "scheduled"
        return
    slot = next_send_slot(ws)
    if slot > utcnow() + timedelta(minutes=1):
        msg.scheduled_at, msg.status = slot, "scheduled"
        return

    provider = s.get("provider")
    owner = (s.get("owner_email") or "").strip()
    if uses_owner_mail(ws, provider, cfg):  # the site owner's account: test emails to the owner only
        if mode == "live":
            _fail(db, msg, "live sending needs your own Gmail or Resend account (Settings > Integrations)")
            return
        owner = cfg.owner_email
    if mode == "test":
        if not owner:
            _fail(db, msg, "test mode needs an owner email (Settings > Sending)")
            return
        to = owner
        subject = f"[TEST -> {msg.to_name} <{msg.to_email}>] {msg.subject}"
    else:
        to = msg.to_email
        subject = msg.subject
    if not provider:
        _fail(db, msg, "choose an email provider in Settings > Sending (Gmail or Resend)")
        return

    first = None
    if msg.step > 0:
        first = db.scalar(select(Message).where(Message.prospect_id == msg.prospect_id, Message.step == 0))
    text = f"{msg.body.rstrip()}\n\n{footer(ws, msg, pb, cfg)}"
    unsub = f"{cfg.public_base_url}/u/{msg.unsubscribe_token}"
    headers = {"List-Unsubscribe": f"<{unsub}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
    if first is not None and first.message_id_header:
        headers["In-Reply-To"] = first.message_id_header
        headers["References"] = first.message_id_header
    from_name = s.get("from_name") or "outreach-os"
    reply_to = (s.get("reply_to") or "").strip()

    try:
        if provider == "gmail":
            user = get_secret(ws, "gmail_user", crypto, cfg)
            password = get_secret(ws, "gmail_app_password", crypto, cfg)
            if not user or not password:
                raise SendRefused("Gmail address or app password missing (Settings > Integrations)")
            mid = make_msgid(domain=user.split("@")[-1])
            em = EmailMessage()
            em["From"] = formataddr((from_name, user))
            em["To"] = to
            em["Subject"] = subject
            em["Message-ID"] = mid
            if reply_to:
                em["Reply-To"] = reply_to
            for k, v in headers.items():
                em[k] = v
            em.set_content(text)
            (sender or _smtp_send)(user, password, em)
            provider_id = mid
        else:
            import resend

            key = get_secret(ws, "resend_api_key", crypto, cfg)
            if not key:
                raise SendRefused("Resend API key missing (Settings > Integrations)")
            from_email = s.get("from_email") or "onboarding@resend.dev"
            mid = make_msgid(domain=from_email.split("@")[-1])
            headers["Message-ID"] = mid
            payload = {"from": formataddr((from_name, from_email)), "to": [to], "subject": subject, "text": text,
                       "headers": headers}
            if reply_to:
                payload["reply_to"] = reply_to
            resend.api_key = key
            resp = (sender or resend.Emails.send)(payload, {"idempotency_key": f"oos-{ws.id}-{msg.id}"})
            provider_id = (resp or {}).get("id")
            if not provider_id:
                raise SendRefused("Resend returned no message id")
    except Exception as exc:  # noqa: BLE001
        secrets = [get_secret(ws, n, crypto, cfg) for n in ("gmail_app_password", "resend_api_key")]
        detail = redact(f"{type(exc).__name__}: {exc}", secrets=[x for x in secrets if x])
        if "403" in detail and "testing emails" in detail:
            detail += " | with onboarding@resend.dev, the owner email must be your Resend account email"
        _fail(db, msg, detail[:500])
        return
    _mark_sent(db, msg, prospect, mode=mode, to=to, provider_id=provider_id, header=mid)


def _smtp_send(user: str, password: str, em: EmailMessage) -> None:
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ctx, timeout=20) as smtp:
        smtp.login(user, password)
        smtp.send_message(em)


def _mark_sent(db: Session, msg: Message, prospect: Prospect, *, mode: str, to: str, provider_id: str | None,
               header: str | None) -> None:
    msg.status, msg.mode, msg.delivered_to = "sent", mode, to
    msg.provider_id, msg.message_id_header = provider_id, header
    msg.sent_at = msg.updated_at = utcnow()
    msg.error = None
    if prospect.status in ("approved", "needs_review", "rejected_draft", "sent"):
        prospect.status = "sent"
        prospect.updated_at = utcnow()
    label = {"demo": "demo send (nothing left the app)", "test": f"sent to your inbox ({to})",
             "live": f"sent to {to}"}[mode]
    step = "first email" if msg.step == 0 else f"follow-up {msg.step}"
    log_event(db, msg.workspace_id, "sent", f"{prospect.domain}: {step} to {msg.to_name}: {label}", level="success",
              campaign_id=msg.campaign_id, prospect_id=prospect.id)


def _fail(db: Session, msg: Message, error: str) -> None:
    msg.status, msg.error, msg.updated_at = "failed", error, utcnow()
    log_event(db, msg.workspace_id, "send_failed", f"{msg.to_email}: {error}", level="error",
              campaign_id=msg.campaign_id, prospect_id=msg.prospect_id)


def send_test_email(ws: Workspace, provider: str, crypto: Crypto, cfg: ServerConfig) -> tuple[bool, str]:
    s = settings_of(ws)["sending"]
    owner = (s.get("owner_email") or "").strip()
    if uses_owner_mail(ws, provider, cfg):  # the site owner's account only mails the site owner
        owner = cfg.owner_email
        if not owner:
            return False, "This site's shared email account is not set up; add your own in Settings > Integrations"
    if not owner:
        return False, "Set an owner email in Settings > Sending first"
    text = "This is a test email from outreach-os. If you can read it, sending works."
    try:
        if provider == "gmail":
            user = get_secret(ws, "gmail_user", crypto, cfg)
            pw = get_secret(ws, "gmail_app_password", crypto, cfg)
            if not user or not pw:
                return False, "Add your Gmail address and an app password first"
            em = EmailMessage()
            em["From"], em["To"], em["Subject"] = formataddr((s.get("from_name") or "outreach-os", user)), owner, "outreach-os test"
            em.set_content(text)
            _smtp_send(user, pw, em)
        else:
            import resend

            key = get_secret(ws, "resend_api_key", crypto, cfg)
            if not key:
                return False, "Add a Resend API key first"
            resend.api_key = key
            resend.Emails.send({"from": formataddr((s.get("from_name") or "outreach-os",
                                                     s.get("from_email") or "onboarding@resend.dev")),
                                "to": [owner], "subject": "outreach-os test", "text": text})
    except Exception as exc:  # noqa: BLE001
        secrets = [get_secret(ws, n, crypto, cfg) for n in ("gmail_app_password", "resend_api_key")]
        msg = redact(f"{type(exc).__name__}: {exc}", secrets=[x for x in secrets if x])
        if isinstance(exc, smtplib.SMTPAuthenticationError):
            msg = "Gmail refused the login: use an app password (Google Account > Security > App passwords)"
        return False, msg[:300]
    return True, f"Test email sent to {owner}"
