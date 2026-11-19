"""The web app end to end over HTTP, in demo mode: signup, campaign, worker ticks, the review
queue, sending, follow-ups, replies, unsubscribe, isolation between workspaces and the guards."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from outreach.server.app import create_app
from outreach.server.config import load_config

SAMPLES = ["ledgerloop.io", "payrollpilot.com", "claimsbridge.ai", "fieldnote.dev", "pocketpals.app",
           "globalbank-cloud.com", "stealthco.xyz", "quietops.io"]
OPEN_WINDOW = {"start_hour": 0, "end_hour": 24, "timezone": "UTC", "weekdays_only": False}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    for var in ("GEMINI_API_KEY", "HUNTER_API_KEY", "RESEND_API_KEY", "DATABASE_URL", "VERCEL"):
        monkeypatch.delenv(var, raising=False)
    overrides = {"DATA_DIR": str(tmp_path), "SECRET_KEY": "test-secret-key-0123456789",
                 "FRONTEND_DIST": str(tmp_path / "nodist"), "OPEN_ACCESS": "0"}
    pg = os.environ.get("OOS_TEST_DATABASE_URL")  # optional: run the same tests on Postgres
    if pg:
        overrides["DATABASE_URL"] = pg
    cfg = load_config(overrides)
    if pg:
        from outreach.server.db import Base, Database

        Base.metadata.drop_all(Database(cfg.database_url).engine)
    app = create_app(cfg, start_worker=False)
    with TestClient(app) as c:
        c.headers.update({"content-type": "application/json", "x-requested-with": "outreach-os"})
        yield c


def signup(c, email="ana@acme.test", name="Ana"):
    r = c.post("/api/auth/signup", json={"email": email, "password": "correct-horse", "name": name,
                                         "workspace_name": "Acme"})
    assert r.status_code == 200, r.text
    return r.json()


def drain(c, rounds=60):
    for _ in range(rounds):
        r = c.post("/api/worker/tick", json={}).json()
        if r["pending"] == 0:
            return
    raise AssertionError("worker did not finish")


def make_campaign(c, **kw):
    pb = c.get("/api/playbooks").json()[0]
    body = {"name": "Q4 SaaS", "playbook_id": pb["id"], "domains": SAMPLES, "auto_approve": False,
            "followups": [{"delay_days": 0}], "hunter_live": False, **kw}
    r = c.post("/api/campaigns", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_full_demo_flow(client):
    c = client
    s = signup(c)
    assert s["workspace"]["demo_mode"] is True and s["workspace"]["onboarded"] is False
    assert c.get("/api/auth/me").json()["user"]["email"] == "ana@acme.test"
    pbs = c.get("/api/playbooks").json()
    assert pbs[0]["product_name"] == "Sprinto"
    c.patch("/api/settings", json={"sending": {"send_window": OPEN_WINDOW}, "onboarded": True})

    camp = make_campaign(c)
    assert camp["stats"]["total"] == 8 and camp["stats"]["queued"] == 8
    drain(c)

    rows = {p["domain"]: p for p in c.get(f"/api/campaigns/{camp['id']}/prospects").json()}
    assert rows["ledgerloop.io"]["status"] == "needs_review"
    assert rows["payrollpilot.com"]["status"] == "needs_review"
    assert rows["pocketpals.app"]["status"] == "disqualified"
    assert rows["globalbank-cloud.com"]["status"] == "disqualified"
    assert rows["stealthco.xyz"]["status"] == "insufficient_data"
    assert rows["quietops.io"]["status"] == "no_contact"
    assert rows["ledgerloop.io"]["contact"]["source"] == "sample"
    assert rows["ledgerloop.io"]["score"]["min"] >= 60

    detail = c.get(f"/api/prospects/{rows['ledgerloop.io']['id']}").json()
    assert detail["summary"].startswith("Qualified")
    assert detail["trail"]["qualify"]["score"]["signals"]
    assert all("text" not in pg for pg in detail["trail"]["scrape"]["pages"])  # page bodies never leave the server
    assert detail["trail"]["draft"]["hook_map"]

    queue = c.get("/api/messages", params={"status": "needs_review"}).json()
    assert len(queue) == 4
    msg = next(m for m in queue if m["company"]["domain"] == "ledgerloop.io")
    assert msg["validation"]["ok"] and "Unsubscribe:" in msg["footer"] and "Unsubscribe" not in msg["body"]

    # a hand edit that invents a claim is caught, then fixed
    bad = c.patch(f"/api/messages/{msg['id']}", json={"body": msg["body"] + " We are the fastest in the market."}).json()
    assert not bad["validation"]["ok"]
    r = c.post(f"/api/messages/{msg['id']}/approve", json={})
    assert r.status_code == 409 and r.json()["errors"]
    good = c.patch(f"/api/messages/{msg['id']}", json={"body": msg["body"]}).json()
    assert good["validation"]["ok"]

    r = c.post(f"/api/messages/{msg['id']}/approve", json={})
    assert r.status_code == 200 and r.json()["status"] == "approved"
    drain(c)
    sent = c.get(f"/api/messages/{msg['id']}").json()
    assert sent["status"] == "sent" and sent["mode"] == "demo"
    p = c.get(f"/api/prospects/{msg['prospect_id']}").json()
    assert p["status"] == "sent"

    # follow-up (delay 0) is drafted on the next tick, then sent once approved
    drain(c)
    fu = [m for m in c.get("/api/messages", params={"status": "needs_review"}).json() if m["step"] == 1]
    assert fu and fu[0]["subject"].startswith("Re: ") and fu[0]["validation"]["ok"]
    assert c.post(f"/api/messages/{fu[0]['id']}/approve", json={}).status_code == 200
    drain(c)
    assert c.get(f"/api/messages/{fu[0]['id']}").json()["status"] == "sent"

    # a reply stops the sequence
    c.post(f"/api/messages/{msg['id']}/mark-replied", json={})
    assert c.get(f"/api/prospects/{msg['prospect_id']}").json()["status"] == "replied"

    # regenerate with reviewer guidance, and bulk approve the rest
    other = next(m for m in c.get("/api/messages", params={"status": "needs_review"}).json() if m["step"] == 0)
    regen = c.post(f"/api/messages/{other['id']}/regenerate", json={"instructions": "suggest a call"}).json()
    assert "call" in regen["body"]
    ids = [m["id"] for m in c.get("/api/messages", params={"status": "needs_review"}).json()]
    bulk = c.post("/api/messages/bulk-approve", json={"ids": ids}).json()
    assert bulk["approved"] + bulk["skipped"] == len(ids) and bulk["approved"] >= 1

    # manual contact rescues a no_contact prospect
    nc = rows["quietops.io"]
    r = c.put(f"/api/prospects/{nc['id']}/contact", json={"first_name": "Mia", "last_name": "Chen",
                                                           "email": "mia@quietops.io", "title": "CTO"})
    assert r.status_code == 200
    drain(c)
    nc2 = c.get(f"/api/prospects/{nc['id']}").json()
    assert nc2["status"] == "needs_review" and nc2["contact"]["source"] == "manual"

    # override a gray-band company: only possible after scoring
    thin = rows["stealthco.xyz"]
    assert c.post(f"/api/prospects/{thin['id']}/override", json={}).status_code == 409

    ov = c.get("/api/analytics/overview").json()
    funnel = {f["key"]: f["count"] for f in ov["funnel"]}
    assert funnel["added"] == 8 and funnel["qualified"] >= 4 and funnel["replied"] == 1 and ov["hours_saved"] > 0
    assert c.get("/api/activity").json()
    csv_text = c.get(f"/api/campaigns/{camp['id']}/export.csv").text
    assert "ledgerloop.io" in csv_text.splitlines()[1] or "ledgerloop.io" in csv_text


def test_unsubscribe_and_suppression(client):
    c = client
    signup(c)
    c.patch("/api/settings", json={"sending": {"send_window": OPEN_WINDOW}})
    camp = make_campaign(c, domains=["ledgerloop.io", "payrollpilot.com"], followups=[])
    drain(c)
    by_domain = {m["company"]["domain"]: m for m in c.get("/api/messages", params={"status": "needs_review"}).json()}
    msgs = [by_domain["ledgerloop.io"], by_domain["payrollpilot.com"]]
    from outreach.server.db import Message

    db = c.app.state.services.database
    with db.session() as s:
        token = s.get(Message, msgs[0]["id"]).unsubscribe_token
    page = c.get(f"/u/{token}")
    assert page.status_code == 200 and "Unsubscribe" in page.text
    c.post(f"/u/{token}", headers={"content-type": "application/x-www-form-urlencoded"})
    assert c.get(f"/api/messages/{msgs[0]['id']}").json()["status"] == "cancelled"
    sup = c.get("/api/suppressions").json()
    assert sup and sup[0]["reason"] == "unsubscribed"

    # a suppressed domain is never mailed, even when approved
    c.post("/api/suppressions", json={"value": "payrollpilot.com"})
    m2 = msgs[1]
    c.post(f"/api/messages/{m2['id']}/approve", json={})
    drain(c)
    assert c.get(f"/api/messages/{m2['id']}").json()["status"] == "cancelled"
    assert camp["id"]


def test_workspaces_are_isolated_and_guards_hold(client):
    c = client
    signup(c)
    camp = make_campaign(c, domains=["ledgerloop.io"])
    pid = c.get(f"/api/campaigns/{camp['id']}/prospects").json()[0]["id"]
    c.post("/api/auth/logout", json={})
    assert c.get("/api/campaigns").status_code == 401

    signup(c, email="bob@other.test", name="Bob")
    assert c.get("/api/campaigns").json() == []
    assert c.get(f"/api/campaigns/{camp['id']}").status_code == 404
    assert c.get(f"/api/prospects/{pid}").status_code == 404
    assert c.post("/api/worker/tick", json={}).json()["processed"] == 0  # bob's tick never runs ana's work

    # CSRF guard: mutating requests must be JSON
    r = c.post("/api/campaigns", content="name=x", headers={"content-type": "application/x-www-form-urlencoded"})
    assert r.status_code == 415
    # duplicate signup, bad login, weak password
    assert c.post("/api/auth/signup", json={"email": "bob@other.test", "password": "x" * 9, "name": "B"}).status_code == 409
    assert c.post("/api/auth/login", json={"email": "bob@other.test", "password": "wrong-pass"}).status_code == 401
    assert c.post("/api/auth/signup", json={"email": "z@z.test", "password": "short", "name": "Z"}).status_code == 422
    assert c.get("/api/cron/tick").status_code == 401


def test_settings_secrets_and_live_mode_gate(client):
    c = client
    signup(c)
    s = c.put("/api/settings/secrets", json={"gemini_api_key": "AIza-test-key-123456", "gmail_user": "me@gmail.com",
                                             "gmail_app_password": "abcd efgh ijkl mnop"}).json()
    assert s["integrations"]["gemini"] == {"configured": True, "source": "workspace", "hint": "…3456"}
    assert s["integrations"]["gmail"]["configured"] and s["integrations"]["gmail"]["hint"] == "me@gmail.com"
    assert "AIza" not in str(s)
    r = c.patch("/api/settings", json={"sending": {"mode": "live", "provider": "gmail"}})
    assert r.status_code == 422 and "postal address" in r.json()["detail"]
    ok = c.patch("/api/settings", json={"sending": {"mode": "live", "provider": "gmail", "from_name": "Ana",
                                                    "physical_address": "1 Main St, Springfield"}})
    assert ok.status_code == 200 and ok.json()["live_ready"]["ok"]
    assert c.patch("/api/settings", json={"models": {"smart": "gemini-latest"}}).status_code == 422


def test_playbook_editing_and_generation(client):
    c = client
    signup(c)
    pb = c.get(f"/api/playbooks/{c.get('/api/playbooks').json()[0]['id']}").json()
    pb["icp"]["signals"][0]["weight"] = 50
    r = c.put(f"/api/playbooks/{pb['id']}", json=pb)
    assert r.status_code == 422 and any("sum to 100" in e for e in r.json()["errors"])
    pb["icp"]["signals"][0]["weight"] = 10
    pb["value_claims"].append({"id": "S3", "text": "Sprinto gets teams audit-ready in weeks"})
    r = c.put(f"/api/playbooks/{pb['id']}", json=pb)
    assert r.status_code == 200 and r.json()["version"] == 2
    gen = c.post("/api/playbooks/generate", json={"website": "https://ledgerloop.io"})
    assert gen.status_code == 200, gen.text
    assert gen.json()["template"] in ("generated", "blank")
    blank = c.post("/api/playbooks", json={"template": "blank", "name": "Payroll outbound"}).json()
    assert blank["name"] == "Payroll outbound"
    camp = make_campaign(c, domains=["ledgerloop.io"])
    assert c.delete(f"/api/playbooks/{camp['playbook']['id']}").status_code == 409


def test_test_mode_sends_through_gmail_to_the_owner_only(client, monkeypatch):
    c = client
    signup(c)
    sent = []
    from outreach.server import mailer

    monkeypatch.setattr(mailer, "_smtp_send", lambda user, pw, em: sent.append(em))
    c.put("/api/settings/secrets", json={"gmail_user": "me@gmail.com", "gmail_app_password": "app-password-1"})
    c.patch("/api/settings", json={"demo_mode": False, "sending": {"provider": "gmail", "send_window": OPEN_WINDOW}})
    # research still runs on the demo web: switch demo on, draft, then off to send for real
    c.patch("/api/settings", json={"demo_mode": True})
    make_campaign(c, domains=["ledgerloop.io"], followups=[])
    drain(c)
    msg = c.get("/api/messages", params={"status": "needs_review"}).json()[0]
    c.patch("/api/settings", json={"demo_mode": False})
    c.post(f"/api/messages/{msg['id']}/approve", json={})
    drain(c)
    out = c.get(f"/api/messages/{msg['id']}").json()
    assert out["status"] == "sent" and out["mode"] == "test" and out["delivered_to"] == "ana@acme.test"
    em = sent[0]
    assert em["To"] == "ana@acme.test" and em["Subject"].startswith(f"[TEST -> {msg['to']['name']} <{msg['to']['email']}>]")
    assert "List-Unsubscribe" in em and "/u/" in em.get_content()


def test_csv_export_neutralises_formulas(client):
    c = client
    signup(c)
    camp = make_campaign(c, domains=["ledgerloop.io"])
    from outreach.server.db import Prospect

    with c.app.state.services.database.session() as s:
        p = s.query(Prospect).first()
        p.company_name = '=HYPERLINK("http://evil.example","x")'
    text = c.get(f"/api/campaigns/{camp['id']}/export.csv").text
    assert "'=HYPERLINK" in text and ',=HYPERLINK' not in text


def test_guest_is_off_when_open_access_is_off(client):
    assert client.post("/api/auth/guest", json={}).status_code == 403


def test_guest_workspace_needs_no_sign_in(tmp_path, monkeypatch):
    for var in ("GEMINI_API_KEY", "HUNTER_API_KEY", "RESEND_API_KEY", "DATABASE_URL", "VERCEL", "OPEN_ACCESS"):
        monkeypatch.delenv(var, raising=False)
    cfg = load_config({"DATA_DIR": str(tmp_path), "SECRET_KEY": "test-secret-key-0123456789",
                       "FRONTEND_DIST": str(tmp_path / "nodist")})  # open access is the default
    with TestClient(create_app(cfg, start_worker=False)) as client:
        client.headers.update({"content-type": "application/json", "x-requested-with": "outreach-os"})
        _guest_checks(client)


def _guest_checks(client):
    assert client.get("/api/auth/me").status_code == 401
    s = client.post("/api/auth/guest", json={}).json()
    assert s["workspace"]["onboarded"] and s["workspace"]["demo_mode"]
    # the same browser keeps its workspace; a new browser gets its own
    assert client.post("/api/auth/guest", json={}).json()["workspace"]["id"] == s["workspace"]["id"]
    assert client.get("/api/auth/me").json()["workspace"]["id"] == s["workspace"]["id"]
    assert client.get("/api/campaigns").status_code == 200
    client.cookies.clear()
    assert client.post("/api/auth/guest", json={}).json()["workspace"]["id"] != s["workspace"]["id"]
    # a guest controls their own workspace: keys, sending and demo mode
    assert client.put("/api/settings/secrets", json={"gemini_api_key": "guest-own-key"}).status_code == 200
    assert client.patch("/api/settings", json={"sending": {"owner_email": "prof@uni.test"}}).status_code == 200
    assert client.patch("/api/settings", json={"demo_mode": False}).json()["demo_mode"] is False


def test_owner_mail_account_only_mails_the_owner(tmp_path, monkeypatch):
    """With the owner's Gmail in the environment, a guest can send test emails, but only to OWNER_EMAIL."""
    from outreach.server.db import Workspace
    from outreach.server.mailer import live_ready, send_test_email, uses_owner_mail
    from outreach.server.security import Crypto

    for var in ("GMAIL_USER", "GMAIL_APP_PASSWORD", "DATABASE_URL", "VERCEL", "OPEN_ACCESS"):
        monkeypatch.delenv(var, raising=False)
    cfg = load_config({"DATA_DIR": str(tmp_path), "SECRET_KEY": "test-secret-key-0123456789",
                       "GMAIL_USER": "owner@gmail.test", "GMAIL_APP_PASSWORD": "pw", "OWNER_EMAIL": "owner@site.test"})
    ws = Workspace(name="g", settings={"sending": {"provider": "gmail", "owner_email": "victim@else.test",
                                                   "physical_address": "1 Road", "from_name": "G"}}, secrets={})
    assert uses_owner_mail(ws, "gmail", cfg)
    assert any("own Gmail" in m for m in live_ready(ws, Crypto(cfg.secret_key), cfg))
    sent = []
    monkeypatch.setattr("outreach.server.mailer._smtp_send", lambda u, p, em: sent.append(em["To"]))
    ok, _ = send_test_email(ws, "gmail", Crypto(cfg.secret_key), cfg)
    assert ok and sent == ["owner@site.test"]


def test_guest_starts_with_the_sites_resend_account(tmp_path, monkeypatch):
    for var in ("GEMINI_API_KEY", "HUNTER_API_KEY", "GMAIL_USER", "GMAIL_APP_PASSWORD", "DATABASE_URL", "VERCEL",
                "OPEN_ACCESS"):
        monkeypatch.delenv(var, raising=False)
    cfg = load_config({"DATA_DIR": str(tmp_path), "SECRET_KEY": "test-secret-key-0123456789",
                       "FRONTEND_DIST": str(tmp_path / "nodist"), "RESEND_API_KEY": "re_test",
                       "OWNER_EMAIL": "owner@site.test"})
    with TestClient(create_app(cfg, start_worker=False)) as c:
        c.headers.update({"content-type": "application/json", "x-requested-with": "outreach-os"})
        c.post("/api/auth/guest", json={})
        s = c.get("/api/settings").json()
        assert s["sending"]["provider"] == "resend" and s["sending"]["mode"] == "test"
        assert s["sending"]["owner_email"] == ""  # the owner's address is never shown to visitors


def test_owner_gemini_key_is_capped_per_workspace_and_site(tmp_path, monkeypatch):
    from outreach.server.db import Database, Workspace
    from outreach.server.pipeline import owner_key_cap

    for var in ("GEMINI_API_KEY", "DATABASE_URL", "VERCEL", "OPEN_ACCESS"):
        monkeypatch.delenv(var, raising=False)
    cfg = load_config({"DATA_DIR": str(tmp_path), "SECRET_KEY": "test-secret-key-0123456789",
                       "GEMINI_API_KEY": "owner-key", "OPEN_MAX_DOMAINS": "2", "OPEN_MAX_PROSPECTS": "3"})
    database = Database(cfg.database_url)
    database.create_all()
    with database.session() as db:
        a, b, own = Workspace(name="a", secrets={}), Workspace(name="b", secrets={}), Workspace(name="c", secrets={"gemini_api_key": "x"})
        db.add_all([a, b, own])
        db.flush()
        assert owner_key_cap(db, a, cfg) is None and owner_key_cap(db, a, cfg) is None
        assert "This workspace" in owner_key_cap(db, a, cfg)          # 2 per workspace a day
        assert owner_key_cap(db, b, cfg) is None                      # site total is now 3
        assert "daily limit of 3" in owner_key_cap(db, b, cfg)       # then the site-wide cap
        assert owner_key_cap(db, own, cfg) is None                    # own key: no cap
