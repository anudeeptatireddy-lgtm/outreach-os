"""Drive the engine for one prospect, one stage per call, persisting after every stage.

Stage-at-a-time keeps every request short (serverless friendly), makes progress visible live in
the dashboard, and means a crash or timeout loses at most one stage. Stage outputs live in
`Prospect.trail` and are rebuilt into typed models for the next stage, exactly as the original
stateless runner did, but held on the server so a client can never forge them.
"""

from __future__ import annotations

import io
import secrets
import tempfile
from datetime import timedelta
from pathlib import Path

from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from outreach import stages as stages_mod
from outreach.audit import RunStore
from outreach.config import Settings, redact
from outreach.draft import _company, build_evidence_pack, validate_draft
from outreach.models import CompanyProfile, DraftLLM, ClaimUsed, HunterContact
from outreach.playbook import Playbook
from outreach.server.config import ServerConfig
from outreach.server.db import Campaign, EventRow, HunterCacheRow, Message, PlaybookRow, Prospect, Workspace, utcnow
from outreach.server.security import Crypto
from outreach.server.workspace import get_secret, hunter_usage, log_event, record_hunter_call, secret_source, settings_of
from outreach.skeleton import Context
from outreach.stages import STAGE_MODELS, DomainUnreachable, StopStage

PIPELINE = ("scrape", "extract", "qualify", "poc", "draft")
ACTIVE = ("queued", "researching")
MAX_ATTEMPTS = 3
PAGE_TEXT_CAP = 20_000


class SystemicError(Exception):
    """A problem with the workspace's setup (bad key, exhausted quota), not with the prospect."""


# --------------------------------------------------------------------------- engine wiring


def engine_settings(ws: Workspace, crypto: Crypto, cfg: ServerConfig) -> Settings:
    st = settings_of(ws)
    cache = cfg.cache_root / f"ws{ws.id}"
    return Settings(
        gemini_api_key=SecretStr(get_secret(ws, "gemini_api_key", crypto, cfg)),
        hunter_api_key=SecretStr(get_secret(ws, "hunter_api_key", crypto, cfg)),
        resend_api_key=SecretStr(get_secret(ws, "resend_api_key", crypto, cfg)),
        owner_email=st["sending"].get("owner_email") or "",
        gemini_model_smart=st["models"]["smart"],
        gemini_model_fast=st["models"]["fast"],
        hunter_monthly_budget=hunter_usage(ws)["monthly_budget"],
        cache_dir=cache,
        out_dir=Path(tempfile.gettempdir()) / "outreach-out",
    )


class DbHunter:
    """Hunter Domain Search with the cache and the monthly budget in the database."""

    def __init__(self, db: Session, ws: Workspace, api_key: str, cache_dir: Path):
        self.db, self.ws, self.key, self.cache_dir = db, ws, api_key, cache_dir
        self.live_calls_this_process = 0
        self.shared_budget: int | None = None

    def domain_search(self, domain: str) -> dict:
        from outreach.hunter import HunterAuthError, HunterClient, HunterQuotaError

        row = self.db.get(HunterCacheRow, domain)
        if row is not None:
            return {"domain": domain, "response": row.response, "from_cache": True, "source": "cache"}
        if not self.key:
            raise HunterAuthError("Hunter API key is not set: add it in Settings > Integrations")
        usage = hunter_usage(self.ws)
        if self.shared_budget is not None:  # open access: one budget for the owner's key
            from sqlalchemy import func

            month_start = utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            used = self.db.scalar(select(func.count()).select_from(HunterCacheRow)
                                  .where(HunterCacheRow.created_at >= month_start)) or 0
            usage = {"used_this_month": used, "monthly_budget": self.shared_budget}
        if usage["used_this_month"] >= usage["monthly_budget"]:
            raise HunterQuotaError(
                f"Hunter monthly budget of {usage['monthly_budget']} searches reached: raise it in Settings "
                "or add contacts by hand"
            )
        client = HunterClient(self.key, self.cache_dir / "hunter", 10**6, instance_counter=False)
        result = client.domain_search(domain)
        self.live_calls_this_process += 1
        record_hunter_call(self.ws)
        self.db.merge(HunterCacheRow(domain=domain, response=result.get("response") or {}))
        return {**result, "source": "live"}

    def account(self) -> dict:
        return {"plan": None, "reset_date": None, "remaining": None}


OWNER_KEY_EVENT = "owner_key_company"


def owner_key_cap(db: Session, ws: Workspace, cfg: ServerConfig) -> str | None:
    """On a no-sign-in site, companies researched on the site owner's Gemini key are capped per
    workspace and site-wide per day (anyone can open a new workspace). Returns why, when over."""
    if not cfg.open_access or secret_source(ws, "gemini_api_key", cfg) != "env":
        return None
    day = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    q = select(func.count()).select_from(EventRow).where(EventRow.kind == OWNER_KEY_EVENT, EventRow.at >= day)
    if (db.scalar(q) or 0) >= cfg.open_max_prospects:
        return (f"This site's daily limit of {cfg.open_max_prospects} companies on real data is reached. Try demo "
                "mode, add your own Gemini key in Settings > Integrations, or come back tomorrow.")
    if (db.scalar(q.where(EventRow.workspace_id == ws.id)) or 0) >= cfg.open_max_domains:
        return (f"This workspace has researched {cfg.open_max_domains} companies on real data today, the limit on "
                "this site. Add your own Gemini key in Settings > Integrations to go further.")
    db.add(EventRow(workspace_id=ws.id, kind=OWNER_KEY_EVENT, message="company researched on the site's key"))
    return None


def build_context(db: Session, ws: Workspace, campaign: Campaign | None, pb: Playbook,
                  crypto: Crypto, cfg: ServerConfig) -> Context:
    settings = engine_settings(ws, crypto, cfg)
    if ws.demo_mode:
        from outreach.demo import DemoFetcher, DemoHunter, DemoLLM

        llm, fetcher, hunter = DemoLLM(), DemoFetcher(), DemoHunter()
    else:
        from outreach.fetch import PageFetcher
        from outreach.llm import LLMClient

        key = settings.gemini_api_key.get_secret_value()
        if not key:
            raise SystemicError("Gemini API key is not set: add it in Settings > Integrations, or turn on demo mode")
        llm = LLMClient(key, cache_dir=settings.cache_dir / "llm")
        fetcher = PageFetcher(settings.cache_dir / "pages")
        hunter = DbHunter(db, ws, settings.hunter_api_key.get_secret_value(), settings.cache_dir)
        if cfg.open_access and secret_source(ws, "hunter_api_key", cfg) == "env":  # the owner's key: one shared cap
            import os

            hunter.shared_budget = int(os.environ.get("HUNTER_MONTHLY_BUDGET", "25") or 25)
    return Context(settings=settings, llm=llm, hunter=hunter, fetcher=fetcher,
                   store=RunStore(settings.out_dir), dry_run=True, out=io.StringIO(),
                   playbook=pb, rubric=pb.loaded_rubric())


def playbook_for(db: Session, campaign: Campaign) -> tuple[Playbook, int]:
    row = db.get(PlaybookRow, campaign.playbook_id)
    return Playbook.model_validate(row.data), row.version


# --------------------------------------------------------------------------- trail helpers


def _slim_scrape(data: dict) -> dict:
    """Keep page text only for usable pages (later stages need it), capped."""
    pages = []
    for p in data.get("pages", []):
        p = dict(p)
        if p.get("text"):
            p["text"] = p["text"][:PAGE_TEXT_CAP]
        p["links"] = (p.get("links") or [])[:60]
        pages.append(p)
    return {**data, "pages": pages}


def _prev(trail: dict, upto: str) -> dict:
    prev = {}
    for name in PIPELINE[: PIPELINE.index(upto)]:
        prev[name] = STAGE_MODELS[name].model_validate(trail[name])
    return prev


def profile_of(prospect: Prospect) -> CompanyProfile | None:
    t = prospect.trail or {}
    data = (t.get("qualify") or {}).get("profile") or (t.get("extract") or {}).get("profile")
    return CompanyProfile.model_validate(data) if data else None


def _summary(q: dict) -> str:
    s = q["score"]
    verdict = {"qualified": "Qualified", "disqualified": "Disqualified",
               "insufficient_data": "Not enough data"}[q["verdict"]]
    rng = f"{s['score_min']}" if s["score_min"] == s["score_max"] else f"{s['score_min']}-{s['score_max']}"
    failed = [g["label"] for g in s.get("gates", []) if g["status"] == "fail"]
    if failed:
        return f"{verdict}: failed gate ({failed[0].lower()})"
    strong = sorted((x for x in s["signals"] if x["status"] == "known" and x["points_min"] > 0),
                    key=lambda x: -x["points_min"])[:3]
    why = "; ".join(f"{x['label'].lower()} (+{x['points_min']})" for x in strong)
    penalties = "; ".join(f"{p['label'].lower()} (-{p['points']})" for p in s.get("penalties", []))
    tail = "; ".join(t for t in (why, penalties) if t)
    return f"{verdict}, score {rng} of 100" + (f": {tail}" if tail else "")


def _contact_dict(c: HunterContact, source: str) -> dict:
    name = " ".join(p for p in (c.first_name, c.last_name) if p)
    return {"name": name, "first_name": c.first_name, "last_name": c.last_name, "title": c.position,
            "email": c.email, "source": source}


# --------------------------------------------------------------------------- one stage


def advance(db: Session, prospect: Prospect, crypto: Crypto, cfg: ServerConfig) -> None:
    """Run the next stage for this prospect and persist the outcome."""
    campaign = db.get(Campaign, prospect.campaign_id)
    ws = db.get(Workspace, prospect.workspace_id)
    pb, version = playbook_for(db, campaign)
    trail = dict(prospect.trail or {})
    stage = next(n for n in PIPELINE if n not in trail)
    prospect.status, prospect.stage = "researching", stage
    prospect.playbook_version = version

    if stage == "poc" and prospect.manual_contact is None and not ws.demo_mode and not campaign.hunter_live:
        _stop(db, prospect, trail, "poc", "no_contact",
              "Hunter search is off for this campaign: add a contact by hand", None)
        return

    if stage == PIPELINE[0] and not ws.demo_mode:
        over = owner_key_cap(db, ws, cfg)
        if over:
            _fail(db, prospect, trail, over, final=True)
            return

    ctx = build_context(db, ws, campaign, pb, crypto, cfg)
    if prospect.manual_contact:
        ctx.manual_contact = HunterContact(**{**prospect.manual_contact, "source": "manual"})
    try:
        prev = _prev(trail, stage)
        out = stages_mod.STAGE_FUNCS[stage](ctx, prospect.domain, prev)
    except StopStage as stop:
        if (stage == "qualify" and stop.reason == "insufficient_data" and prospect.override
                and stop.output is not None):
            data = stop.output.model_dump(mode="json")
            data["manual_override"] = "Continued past the gray band by a person (manual override)"
            trail["qualify"] = data
            _after_qualify(prospect, data)
            prospect.trail = trail
            _touch(prospect)
            return
        output = stop.output.model_dump(mode="json") if stop.output is not None else None
        _stop(db, prospect, trail, stage, stop.reason, redact(stop.detail, ctx.settings), output, ctx=ctx, pb=pb)
        return
    except DomainUnreachable as exc:
        trail["scrape"] = {"pages": [], "usable": 0, "kinds_found": [], "fetches": 0}
        _fail(db, prospect, trail, f"Website unreachable: {exc}"[:400], final=True)
        return
    except SystemicError:
        raise
    except Exception as exc:  # noqa: BLE001
        from outreach.hunter import HunterAuthError, HunterQuotaError

        if stage == "poc" and isinstance(exc, (HunterAuthError, HunterQuotaError)):
            # Hunter out of credits or not set up: this company needs a contact by hand, but the
            # campaign keeps going (research and scoring do not depend on Hunter).
            why = "has no searches left" if isinstance(exc, HunterQuotaError) else "is not set up"
            _stop(db, prospect, trail, "poc", "no_contact",
                  f"Hunter {why}: add a contact by hand to draft the email", None)
            return
        _classify_and_raise(exc, ctx.settings)
        prospect.attempts += 1
        msg = redact(f"{stage}: {type(exc).__name__}: {exc}", ctx.settings)[:500]
        if prospect.attempts >= MAX_ATTEMPTS:
            _fail(db, prospect, trail, msg, final=True)
        else:
            prospect.run_after = utcnow() + timedelta(seconds=20 * prospect.attempts)
            prospect.error = msg
            _touch(prospect)
        return

    data = out.model_dump(mode="json")
    if stage == "scrape":
        data = _slim_scrape(data)
    trail[stage] = data
    prospect.attempts, prospect.error = 0, None
    if stage == "extract":
        prof = data.get("profile") or {}
        prospect.company_name = (prof.get("name") or {}).get("value") or prospect.company_name
    if stage == "qualify":
        _after_qualify(prospect, data)
        log_event(db, prospect.workspace_id, "qualified", f"{prospect.domain}: {prospect.summary}",
                  level="success", campaign_id=prospect.campaign_id, prospect_id=prospect.id)
    if stage == "poc":
        source = "manual" if prospect.manual_contact else ("sample" if ws.demo_mode else "hunter")
        prospect.contact = _contact_dict(out.contact, source)
    prospect.trail = trail
    if stage == "draft":
        create_first_message(db, prospect, campaign, pb, data)
    _touch(prospect)


def _after_qualify(prospect: Prospect, data: dict) -> None:
    s = data["score"]
    prospect.score_min, prospect.score_max = s["score_min"], s["score_max"]
    prospect.score_expected = s.get("score_expected")
    prospect.summary = _summary(data)
    prospect.company_name = ((data.get("profile") or {}).get("name") or {}).get("value") or prospect.company_name


def _touch(prospect: Prospect) -> None:
    prospect.updated_at = utcnow()


STOP_STATUS = {"disqualified": "disqualified", "insufficient_data": "insufficient_data",
               "no_contact": "no_contact", "rejected_draft": "rejected_draft"}


def _stop(db, prospect, trail, stage, reason, detail, output, *, ctx=None, pb=None) -> None:
    if output is not None:
        trail[stage] = output if stage != "scrape" else _slim_scrape(output)
    trail["stop"] = {"stage": stage, "reason": reason, "detail": detail}
    prospect.trail = trail
    prospect.status = STOP_STATUS.get(reason, "failed")
    prospect.stage = None
    if stage == "qualify" and output is not None:
        _after_qualify(prospect, output)
    elif reason == "insufficient_data" and stage == "scrape":
        prospect.summary = f"Not enough data: {detail}"
    if reason == "rejected_draft" and output is not None and pb is not None:
        campaign = db.get(Campaign, prospect.campaign_id)
        create_first_message(db, prospect, campaign, pb, output, rejected=True)
    level = "warning" if reason in ("no_contact", "rejected_draft", "insufficient_data") else "info"
    log_event(db, prospect.workspace_id, reason, f"{prospect.domain}: {prospect.summary or detail or reason}",
              level=level, campaign_id=prospect.campaign_id, prospect_id=prospect.id)
    _touch(prospect)


def _fail(db, prospect, trail, msg, *, final: bool) -> None:
    prospect.trail = trail
    prospect.status, prospect.stage, prospect.error = "failed", None, msg
    log_event(db, prospect.workspace_id, "failed", f"{prospect.domain}: {msg}", level="error",
              campaign_id=prospect.campaign_id, prospect_id=prospect.id)
    _touch(prospect)


def _classify_and_raise(exc: Exception, settings: Settings) -> None:
    from outreach.hunter import HunterAuthError, HunterQuotaError
    from outreach.llm import LLMAuthError, LLMQuotaError

    if isinstance(exc, LLMAuthError):
        raise SystemicError("Gemini rejected the API key: update it in Settings > Integrations") from None
    if isinstance(exc, HunterAuthError):
        raise SystemicError(redact(str(exc), settings)) from None
    if isinstance(exc, (LLMQuotaError, HunterQuotaError)):
        raise SystemicError(redact(str(exc), settings)) from None


# --------------------------------------------------------------------------- messages


def new_token() -> str:
    return secrets.token_urlsafe(24)


def create_first_message(db: Session, prospect: Prospect, campaign: Campaign, pb: Playbook, draft: dict,
                         *, rejected: bool = False) -> Message:
    contact = (prospect.trail.get("poc") or {}).get("contact") or {}
    name = " ".join(p for p in (contact.get("first_name"), contact.get("last_name")) if p)
    validation = draft.get("validation") or {"ok": not rejected, "failures": []}
    for old in db.scalars(select(Message).where(Message.prospect_id == prospect.id, Message.step == 0,
                                                Message.status.in_(("needs_review", "rejected")))):
        db.delete(old)
    msg = Message(
        workspace_id=prospect.workspace_id, campaign_id=campaign.id, prospect_id=prospect.id, step=0,
        to_name=name, to_email=contact.get("email", ""), to_title=contact.get("position", ""),
        subject=draft["draft"]["subject"], body=draft.get("core_body") or draft["draft"]["body"],
        validation={"ok": bool(validation.get("ok")), "failures": list(validation.get("failures") or [])},
        hook_map=draft.get("hook_map") or [], pain_points=draft.get("pain_points") or [],
        claims=draft.get("claims_used") or [], unsubscribe_token=new_token(), status="needs_review",
    )
    if campaign.auto_approve and msg.validation["ok"]:
        msg.status = "approved"
        prospect.status = "approved"
    else:
        prospect.status = "rejected_draft" if rejected else "needs_review"
    prospect.stage = None
    db.add(msg)
    log_event(db, prospect.workspace_id, "drafted",
              f"{prospect.domain}: email to {name} ({contact.get('position', '')}) "
              + ("approved automatically" if msg.status == "approved" else "is ready for review"),
              level="success" if not rejected else "warning", campaign_id=campaign.id, prospect_id=prospect.id)
    return msg


def revalidate(db: Session, msg: Message, pb: Playbook) -> dict:
    """Run the deterministic validator over a (possibly hand-edited) message."""
    prospect = db.get(Prospect, msg.prospect_id)
    profile = profile_of(prospect)
    contact = prospect.trail.get("poc", {}).get("contact") if prospect.trail else None
    if profile is None or not contact:
        return {"ok": True, "failures": []}
    hc = HunterContact.model_validate(contact)
    pack = build_evidence_pack(profile, pb)
    claims = [ClaimUsed.model_validate(c) for c in (msg.claims or [])]
    rules = pb
    if msg.step > 0:
        from outreach.followup import _rules

        rules = _rules(pb)
        subject = db.scalar(select(Message.subject).where(Message.prospect_id == msg.prospect_id,
                                                          Message.step == 0)) or msg.subject
    else:
        subject = msg.subject
    failures = validate_draft(DraftLLM(subject=subject, body=msg.body, claims_used=claims), hc, pack,
                              _company(profile), rules, require_hook=msg.step == 0)
    return {"ok": not failures, "failures": failures}


def regenerate(db: Session, msg: Message, instructions: str | None, crypto: Crypto, cfg: ServerConfig) -> None:
    prospect = db.get(Prospect, msg.prospect_id)
    campaign = db.get(Campaign, msg.campaign_id)
    ws = db.get(Workspace, msg.workspace_id)
    pb, _ = playbook_for(db, campaign)
    ctx = build_context(db, ws, campaign, pb, crypto, cfg)
    if msg.step == 0:
        ctx.draft_instructions = instructions
        prev = _prev(prospect.trail, "draft")
        try:
            out = stages_mod.stage_draft(ctx, prospect.domain, prev)
            data = out.model_dump(mode="json")
        except StopStage as stop:
            data = stop.output.model_dump(mode="json")
        trail = dict(prospect.trail)
        trail["draft"] = data
        trail.pop("stop", None)
        prospect.trail = trail
        msg.subject = data["draft"]["subject"]
        msg.body = data.get("core_body") or data["draft"]["body"]
        v = data.get("validation") or {}
        msg.validation = {"ok": bool(v.get("ok")), "failures": list(v.get("failures") or [])}
        msg.hook_map, msg.pain_points, msg.claims = data.get("hook_map", []), data.get("pain_points", []), data.get("claims_used", [])
        prospect.status = "needs_review"
    else:
        fu = _followup(db, prospect, pb, ctx, msg.step)
        msg.body, msg.claims = fu.body, [c.model_dump() for c in fu.claims_used]
        msg.validation = {"ok": fu.validation.ok, "failures": fu.validation.failures}
    msg.status = "needs_review"
    msg.updated_at = utcnow()
    log_event(db, msg.workspace_id, "regenerated", f"{prospect.domain}: draft regenerated", campaign_id=msg.campaign_id,
              prospect_id=prospect.id)


def _followup(db: Session, prospect: Prospect, pb: Playbook, ctx: Context, step: int):
    from outreach.followup import build_followup

    first = db.scalar(select(Message).where(Message.prospect_id == prospect.id, Message.step == 0))
    bodies = list(db.scalars(select(Message.body).where(Message.prospect_id == prospect.id, Message.step < step)
                             .order_by(Message.step)))
    contact = HunterContact.model_validate(prospect.trail["poc"]["contact"])
    return build_followup(ctx.llm, model=ctx.settings.gemini_model_smart, playbook=pb, profile=profile_of(prospect),
                          contact=contact, first_subject=first.subject, previous_bodies=bodies, step=step)


def create_followup(db: Session, prospect: Prospect, campaign: Campaign, step: int, crypto: Crypto,
                    cfg: ServerConfig) -> Message:
    ws = db.get(Workspace, prospect.workspace_id)
    pb, _ = playbook_for(db, campaign)
    ctx = build_context(db, ws, campaign, pb, crypto, cfg)
    fu = _followup(db, prospect, pb, ctx, step)
    first = db.scalar(select(Message).where(Message.prospect_id == prospect.id, Message.step == 0))
    msg = Message(
        workspace_id=prospect.workspace_id, campaign_id=campaign.id, prospect_id=prospect.id, step=step,
        to_name=first.to_name, to_email=first.to_email, to_title=first.to_title, subject=fu.subject, body=fu.body,
        validation={"ok": fu.validation.ok, "failures": fu.validation.failures}, hook_map=[], pain_points=[],
        claims=[c.model_dump() for c in fu.claims_used], unsubscribe_token=new_token(),
        status="approved" if (campaign.auto_approve and fu.validation.ok) else "needs_review",
    )
    db.add(msg)
    log_event(db, prospect.workspace_id, "followup_drafted",
              f"{prospect.domain}: follow-up {step} drafted" + (" and approved" if msg.status == "approved" else ""),
              campaign_id=campaign.id, prospect_id=prospect.id)
    return msg
