"""Request dependencies: the app services and the signed-in user."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from outreach.server.config import ServerConfig
from outreach.server.db import Database, User, Workspace
from outreach.server.security import SESSION_COOKIE, Crypto


@dataclass
class Services:
    database: Database
    crypto: Crypto
    cfg: ServerConfig
    worker: object | None = None


def services(request: Request) -> Services:
    return request.app.state.services


def get_db(svc: Services = Depends(services)) -> Iterator[Session]:
    with svc.database.session() as db:
        yield db


@dataclass
class Caller:
    user: User
    ws: Workspace


def caller(request: Request, db: Session = Depends(get_db), svc: Services = Depends(services)) -> Caller:
    uid = svc.crypto.read_session(request.cookies.get(SESSION_COOKIE))
    user = db.get(User, uid) if uid is not None else None
    if user is None:
        raise HTTPException(401, "not_authenticated")
    ws = db.get(Workspace, user.workspace_id)
    return Caller(user=user, ws=ws)


def not_found(what: str = "not found") -> HTTPException:
    return HTTPException(404, what)
