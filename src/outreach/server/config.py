"""Process-wide server configuration, read once from the environment (and a local .env).

Workspace-specific settings (sending, models, API keys) live in the database; the variables
here are deployment concerns. API keys in the environment act as fallbacks for every workspace,
which suits a single-team self-hosted install.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import dotenv_values, find_dotenv

ROOT = Path(__file__).resolve().parents[3]


def _env() -> dict[str, str]:
    found = find_dotenv(usecwd=True)
    values = {k: v for k, v in (dotenv_values(found) if found else {}).items() if v is not None}
    values.update({k: v for k, v in os.environ.items() if v})
    return values


@dataclass(frozen=True)
class ServerConfig:
    data_dir: Path
    database_url: str
    secret_key: str
    public_base_url: str
    worker_enabled: bool
    secure_cookies: bool
    frontend_dist: Path
    env_keys: dict[str, str] = field(default_factory=dict)
    worker_interval_s: float = 2.0
    cron_secret: str = ""

    @property
    def cache_root(self) -> Path:
        return self.data_dir / "cache"


def _secret_key(data_dir: Path, env: dict[str, str]) -> str:
    if env.get("SECRET_KEY"):
        return env["SECRET_KEY"]
    path = data_dir / "secret.key"
    if path.exists():
        return path.read_text().strip()
    key = secrets.token_urlsafe(48)
    data_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(key)
    path.chmod(0o600)
    return key


def load_config(overrides: dict[str, str] | None = None) -> ServerConfig:
    env = _env()
    if overrides:
        env.update(overrides)
    on_vercel = bool(env.get("VERCEL"))
    default_dir = Path("/tmp/outreach") if on_vercel else ROOT / "data"
    data_dir = Path(env.get("DATA_DIR") or default_dir).resolve()
    if on_vercel and not env.get("SECRET_KEY"):
        raise RuntimeError("SECRET_KEY must be set in the Vercel project environment")
    if on_vercel and not env.get("DATABASE_URL"):
        raise RuntimeError("DATABASE_URL (Postgres) must be set in the Vercel project environment")
    data_dir.mkdir(parents=True, exist_ok=True)
    database_url = env.get("DATABASE_URL") or f"sqlite:///{data_dir / 'outreach.db'}"
    for prefix in ("postgres://", "postgresql://"):
        if database_url.startswith(prefix):
            database_url = "postgresql+psycopg://" + database_url.removeprefix(prefix)
    vercel_url = env.get("VERCEL_PROJECT_PRODUCTION_URL") or env.get("VERCEL_URL")
    base = (env.get("PUBLIC_BASE_URL") or (f"https://{vercel_url}" if vercel_url else "http://localhost:8000")).rstrip("/")
    keys = {k: env[k] for k in ("GEMINI_API_KEY", "HUNTER_API_KEY", "RESEND_API_KEY", "GMAIL_USER",
                                "GMAIL_APP_PASSWORD", "RESEND_WEBHOOK_SECRET") if env.get(k)}
    return ServerConfig(
        data_dir=data_dir,
        database_url=database_url,
        secret_key=_secret_key(data_dir, env),
        public_base_url=base,
        worker_enabled=env.get("WORKER_ENABLED", "0" if on_vercel else "1") not in ("0", "false", "no"),
        cron_secret=env.get("CRON_SECRET", ""),
        secure_cookies=base.startswith("https://"),
        frontend_dist=Path(env.get("FRONTEND_DIST") or ROOT / "frontend" / "dist"),
        env_keys=keys,
        worker_interval_s=float(env.get("WORKER_INTERVAL_S", "2")),
    )


@lru_cache(maxsize=1)
def get_config() -> ServerConfig:
    return load_config()
