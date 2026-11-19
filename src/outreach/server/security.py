"""Passwords, sessions and secret encryption.

- Passwords: scrypt (stdlib), per-user salt, constant-time comparison.
- Sessions: a signed, timestamped cookie holding the user id (itsdangerous), 30 days.
- Workspace API keys: Fernet-encrypted with a key derived from SECRET_KEY; never returned.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from collections import defaultdict, deque

from cryptography.fernet import Fernet, InvalidToken
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

SESSION_COOKIE = "oos_session"
SESSION_MAX_AGE = 30 * 24 * 3600
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                             dklen=len(base64.b64decode(dk)))
        return hmac.compare_digest(got, base64.b64decode(dk))
    except (ValueError, TypeError):
        return False


class Crypto:
    def __init__(self, secret_key: str):
        self._serializer = URLSafeTimedSerializer(secret_key, salt="oos-session")
        derived = hashlib.sha256(("fernet:" + secret_key).encode()).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(derived))

    # sessions
    def make_session(self, user_id: int) -> str:
        return self._serializer.dumps({"uid": user_id})

    def read_session(self, token: str | None) -> int | None:
        if not token:
            return None
        try:
            data = self._serializer.loads(token, max_age=SESSION_MAX_AGE)
        except (BadSignature, SignatureExpired):
            return None
        uid = data.get("uid") if isinstance(data, dict) else None
        return uid if isinstance(uid, int) else None

    # secrets
    def encrypt(self, value: str) -> str:
        return self._fernet.encrypt(value.encode()).decode()

    def decrypt(self, token: str) -> str | None:
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except (InvalidToken, ValueError):
            return None


class RateLimiter:
    """A small sliding-window limiter for login and signup attempts (per process)."""

    def __init__(self, limit: int, window_s: float):
        self.limit, self.window = limit, window_s
        self._hits: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        if len(self._hits) > 10_000:
            self._hits.clear()
        return True
