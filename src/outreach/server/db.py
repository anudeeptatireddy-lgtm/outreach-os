"""SQLAlchemy models. SQLite by default, Postgres via DATABASE_URL.

Every row that holds customer data carries `workspace_id`, and every query in the routes filters
on it: a workspace never sees another workspace's data.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from sqlalchemy import (
    JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False)
    demo_mode: Mapped[bool] = mapped_column(Boolean, default=True)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    secrets: Mapped[dict] = mapped_column(JSON, default=dict)  # values are Fernet tokens
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PlaybookRow(Base):
    __tablename__ = "playbooks"
    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    template: Mapped[str | None] = mapped_column(String(40), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Campaign(Base):
    __tablename__ = "campaigns"
    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True)
    playbook_id: Mapped[int] = mapped_column(ForeignKey("playbooks.id"))
    name: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(20), default="running")
    auto_approve: Mapped[bool] = mapped_column(Boolean, default=False)
    hunter_live: Mapped[bool] = mapped_column(Boolean, default=False)
    followups: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Prospect(Base):
    __tablename__ = "prospects"
    __table_args__ = (UniqueConstraint("campaign_id", "domain"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"), index=True)
    domain: Mapped[str] = mapped_column(String(253))
    company_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    stage: Mapped[str | None] = mapped_column(String(20), nullable=True)
    score_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score_expected: Mapped[float | None] = mapped_column(Float, nullable=True)
    contact: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    manual_contact: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    trail: Mapped[dict] = mapped_column(JSON, default=dict)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    override: Mapped[bool] = mapped_column(Boolean, default=False)
    playbook_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # worker bookkeeping: a tick leases one prospect, runs one stage, then releases it
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    run_after: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"), index=True)
    prospect_id: Mapped[int] = mapped_column(ForeignKey("prospects.id"), index=True)
    step: Mapped[int] = mapped_column(Integer, default=0)
    to_name: Mapped[str] = mapped_column(String(200))
    to_email: Mapped[str] = mapped_column(String(254))
    to_title: Mapped[str] = mapped_column(String(200), default="")
    subject: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="needs_review", index=True)
    validation: Mapped[dict] = mapped_column(JSON, default=dict)
    hook_map: Mapped[list] = mapped_column(JSON, default=list)
    pain_points: Mapped[list] = mapped_column(JSON, default=list)
    claims: Mapped[list] = mapped_column(JSON, default=list)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    provider_id: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    message_id_header: Mapped[str | None] = mapped_column(String(300), nullable=True)
    delivered_to: Mapped[str | None] = mapped_column(String(254), nullable=True)
    mode: Mapped[str | None] = mapped_column(String(10), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    unsubscribe_token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    replied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Suppression(Base):
    __tablename__ = "suppressions"
    __table_args__ = (UniqueConstraint("workspace_id", "value"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True)
    value: Mapped[str] = mapped_column(String(254))
    kind: Mapped[str] = mapped_column(String(10))
    reason: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class EventRow(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True)
    campaign_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    prospect_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    kind: Mapped[str] = mapped_column(String(40))
    level: Mapped[str] = mapped_column(String(10), default="info")
    message: Mapped[str] = mapped_column(Text)


class HunterCacheRow(Base):
    """Hunter Domain Search responses, kept forever (empty results too): a credit is never spent
    twice on one domain, even across serverless cold starts. Shared across workspaces because the
    data is about the prospect company, not the workspace."""

    __tablename__ = "hunter_cache"
    domain: Mapped[str] = mapped_column(String(253), primary_key=True)
    response: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class WinRow(Base):
    """An email that earned a positive reply. Its approach (angle, structure, call to action) is
    shown to the writer for similar prospects later; its facts never are reused."""

    __tablename__ = "winning_emails"
    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True)
    playbook_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message_id: Mapped[int] = mapped_column(Integer, unique=True)
    subject: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    persona: Mapped[str] = mapped_column(String(200), default="")
    company: Mapped[str] = mapped_column(String(200), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    uses: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Database:
    def __init__(self, url: str):
        kwargs: dict = {"future": True}
        if url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
        else:
            # Serverless-friendly: a small pool per instance, and no server-side prepared
            # statements (transaction-mode poolers such as Neon's PgBouncer do not keep them).
            kwargs.update(pool_size=3, max_overflow=2, pool_recycle=280,
                          connect_args={"prepare_threshold": None, "connect_timeout": 10})
        self.engine = create_engine(url, pool_pre_ping=True, **kwargs)
        if url.startswith("sqlite"):
            @event.listens_for(self.engine, "connect")
            def _pragmas(dbapi_conn, _record):  # noqa: ANN001
                cur = dbapi_conn.cursor()
                cur.execute("PRAGMA journal_mode=WAL")
                cur.execute("PRAGMA foreign_keys=ON")
                cur.execute("PRAGMA busy_timeout=30000")
                cur.close()
        self.Session = sessionmaker(self.engine, expire_on_commit=False)

    def create_all(self) -> None:
        Base.metadata.create_all(self.engine)

    @contextmanager
    def session(self) -> Iterator[Session]:
        s = self.Session()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()
