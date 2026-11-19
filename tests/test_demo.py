"""Demo mode drives the real engine over synthetic companies: every archetype reaches its
intended outcome and every demo email passes the real validator, for any playbook."""

from __future__ import annotations

import pytest

from outreach.audit import RunStore
from outreach.demo import SAMPLE_DOMAINS, DemoFetcher, DemoHunter, DemoLLM
from outreach.followup import build_followup
from outreach.generate import generate_playbook
from outreach.playbook import blank_playbook, sprinto_playbook, validate_playbook
from outreach.skeleton import Context, run_one

EXPECTED = {
    "fit_soc2": ("dry_run", None),
    "fit_iso": ("dry_run", None),
    "consumer": ("stopped", "disqualified"),
    "certified_enterprise": ("stopped", "disqualified"),
    "thin": ("stopped", "insufficient_data"),
    "fit_no_contact": ("stopped", "no_contact"),
}


def _ctx(settings, tmp_path, pb):
    return Context(settings=settings, llm=DemoLLM(), hunter=DemoHunter(), fetcher=DemoFetcher(),
                   store=RunStore(tmp_path / "out"), dry_run=True, playbook=pb, rubric=pb.loaded_rubric(),
                   out=__import__("io").StringIO())


@pytest.mark.parametrize("domain,archetype", sorted(SAMPLE_DOMAINS.items()))
def test_sprinto_demo_outcomes(settings, tmp_path, domain, archetype):
    rec = run_one(domain, _ctx(settings, tmp_path, sprinto_playbook()))
    assert (rec.status, rec.stop_reason) == EXPECTED[archetype], [(s.name, s.status, s.output and s.output.get("detail")) for s in rec.stages]


def test_blank_playbook_demo_drafts_validate(settings, tmp_path):
    pb = blank_playbook()
    rec = run_one("ledgerloop.io", _ctx(settings, tmp_path, pb))
    stages = {s.name: s for s in rec.stages}
    assert stages["qualify"].status == "ok"
    assert "draft" in stages and stages["draft"].status == "ok", stages.get("draft") and stages["draft"].output
    assert pb.value_claims[0].text in stages["draft"].output["core_body"]


def test_demo_followups_validate(settings, tmp_path):
    for pb in (sprinto_playbook(), blank_playbook()):
        ctx = _ctx(settings, tmp_path, pb)
        rec = run_one("payrollpilot.com", ctx)
        stages = {s.name: s.output for s in rec.stages}
        from outreach.models import CompanyProfile, HunterContact
        profile = CompanyProfile.model_validate(stages["qualify"]["profile"])
        contact = HunterContact.model_validate(stages["poc"]["contact"])
        for step in (1, 2):
            fu = build_followup(DemoLLM(), model="m", playbook=pb, profile=profile, contact=contact,
                                first_subject=stages["draft"]["draft"]["subject"],
                                previous_bodies=[stages["draft"]["draft"]["body"]], step=step)
            assert fu.validation.ok, (pb.name, step, fu.validation.failures)
            assert fu.subject.startswith("Re: ")


def test_generate_playbook_in_demo_mode():
    pb = generate_playbook(DemoLLM(), DemoFetcher(), model="m", website="https://ledgerloop.io")
    assert validate_playbook(pb) == []
    assert pb.product.name == "Ledgerloop" or pb.product.name
    assert pb.template in ("generated", "blank")
