"""Workspace settings, secrets and the activity log."""

from __future__ import annotations

import copy
import time

from sqlalchemy.orm import Session

from outreach.server.config import ServerConfig
from outreach.server.db import EventRow, Workspace
from outreach.server.security import Crypto

SECRET_NAMES = ("gemini_api_key", "hunter_api_key", "resend_api_key", "gmail_user", "gmail_app_password",
                "resend_webhook_secret")
ENV_NAMES = {n: n.upper() for n in SECRET_NAMES}

DEFAULT_SETTINGS: dict = {
    "sending": {
        "mode": "test",
        "provider": None,
        "from_name": "",
        "from_email": "",
        "reply_to": "",
        "owner_email": "",
        "physical_address": "",
        "daily_cap": 30,
        "send_window": {"start_hour": 9, "end_hour": 17, "timezone": "UTC", "weekdays_only": True},
    },
    "models": {"smart": "gemini-3.8-flash", "fast": "gemini-3.5-flash-lite"},
    "hunter": {"monthly_budget": 25, "month": "", "used": 0},
}


def _merge(base: dict, extra: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def settings_of(ws: Workspace) -> dict:
    return _merge(DEFAULT_SETTINGS, ws.settings or {})


def update_settings(ws: Workspace, patch: dict) -> None:
    ws.settings = _merge(settings_of(ws), patch)


def get_secret(ws: Workspace, name: str, crypto: Crypto, cfg: ServerConfig) -> str:
    token = (ws.secrets or {}).get(name)
    if token:
        value = crypto.decrypt(token)
        if value:
            return value
    return cfg.env_keys.get(ENV_NAMES[name], "")


def secret_source(ws: Workspace, name: str, cfg: ServerConfig) -> str | None:
    if (ws.secrets or {}).get(name):
        return "workspace"
    if cfg.env_keys.get(ENV_NAMES[name]):
        return "env"
    return None


def set_secrets(ws: Workspace, values: dict[str, str | None], crypto: Crypto) -> None:
    secrets = dict(ws.secrets or {})
    for name, value in values.items():
        if name not in SECRET_NAMES or value is None:
            continue
        value = value.strip()
        if value:
            secrets[name] = crypto.encrypt(value)
        else:
            secrets.pop(name, None)
    ws.secrets = secrets


def hint(value: str, name: str) -> str | None:
    if not value:
        return None
    if name == "gmail_user":
        return value
    return "…" + value[-4:] if len(value) > 8 else "set"


def hunter_usage(ws: Workspace) -> dict:
    h = settings_of(ws)["hunter"]
    month = time.strftime("%Y-%m")
    used = h.get("used", 0) if h.get("month") == month else 0
    return {"monthly_budget": int(h.get("monthly_budget", 25)), "used_this_month": int(used)}


def record_hunter_call(ws: Workspace) -> None:
    usage = hunter_usage(ws)
    update_settings(ws, {"hunter": {"month": time.strftime("%Y-%m"), "used": usage["used_this_month"] + 1}})


def log_event(
    db: Session, workspace_id: int, kind: str, message: str, *, level: str = "info",
    campaign_id: int | None = None, prospect_id: int | None = None,
) -> None:
    db.add(EventRow(workspace_id=workspace_id, kind=kind, message=message[:2000], level=level,
                    campaign_id=campaign_id, prospect_id=prospect_id))
