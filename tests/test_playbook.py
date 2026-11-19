"""Playbooks: the Sprinto playbook reproduces the original behaviour exactly, any playbook is
validated before use, and the engine reads the playbook instead of constants. Offline only."""

from __future__ import annotations

from conftest import GOOD_BODY, FakeLLM, default_llm_responses
from outreach.draft import DRAFT_SYSTEM, build_draft, build_evidence_pack, draft_system, validate_draft
from outreach.models import ClaimUsed, DraftLLM, HunterContact
from outreach.playbook import (
    Playbook, blank_playbook, from_template, sprinto_playbook, validate_playbook,
)
from outreach.poc import select_contact
from outreach.qualify import load_rubric, score_profile
from outreach.skeleton import run_one

CONTACT = HunterContact(first_name="Richard", last_name="Hendricks", email="r@x.com", position="CEO", source="fixture")
PROFILE = default_llm_responses()["extract"]


def test_templates_are_valid():
    assert validate_playbook(sprinto_playbook()) == []
    assert validate_playbook(blank_playbook()) == []
    assert from_template("sprinto").product.name == "Sprinto"


def test_sprinto_rubric_scores_like_the_hashed_file():
    file_rubric = load_rubric()
    pb_rubric = sprinto_playbook().loaded_rubric()
    assert pb_rubric.rubric == file_rubric.rubric
    kinds = {"home", "about", "careers", "security", "customers"}
    assert score_profile(PROFILE, kinds, file_rubric.rubric) == score_profile(PROFILE, kinds, pb_rubric.rubric)


def test_sprinto_prompts_and_validator_match_the_original():
    pb = sprinto_playbook()
    assert draft_system(pb).startswith(DRAFT_SYSTEM)
    pack = build_evidence_pack(PROFILE, pb)
    good = DraftLLM(subject="your soc 2 timeline", body=GOOD_BODY, claims_used=[ClaimUsed(claim="SOC 2", evidence_id="E1")])
    assert validate_draft(good, CONTACT, pack, "Acme Ledger", pb) == []
    assert validate_draft(good, CONTACT, pack, "Acme Ledger") == []


def test_sprinto_personas_rank_like_the_original():
    def entry(first, position):
        return {"first_name": first, "last_name": "X", "value": f"{first.lower()}@x.com", "position": position,
                "confidence": 95, "verification": {"status": "valid"}}

    result = {"source": "fixture", "response": {"data": {"emails": [
        entry("Ceo", "CEO"), entry("Cto", "CTO"), entry("Sec", "Head of Security"), entry("Mkt", "VP Marketing")]}}}
    personas = sprinto_playbook().personas
    a = select_contact(result, PROFILE)
    b = select_contact(result, PROFILE, personas)
    assert a.contact == b.contact and a.contact.first_name == "Sec"


def test_a_custom_product_drives_claims_and_validator():
    pb = blank_playbook("Acme")
    pb.product.name = "Ledgerly"
    pb.value_claims[0].text = "Ledgerly closes the books in days instead of weeks"
    pack = build_evidence_pack(PROFILE, pb)
    body = GOOD_BODY.replace(
        "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection.",
        "Ledgerly closes the books in days instead of weeks.",
    )
    claims = [ClaimUsed(claim="SOC 2", evidence_id="E1")]
    ok = DraftLLM(subject="your soc 2 timeline", body=body, claims_used=claims)
    fails = validate_draft(ok, CONTACT, pack, "Acme Ledger", pb)
    assert not any("claim outside" in f for f in fails), fails
    bad = DraftLLM(subject="ledgerly for you", body=body.replace("Would a short", "We cut audit time. Would a short"),
                   claims_used=claims)
    fails = validate_draft(bad, CONTACT, pack, "Acme Ledger", pb)
    assert any("subject must not name Ledgerly" in f for f in fails)
    assert any("claim outside the whitelist" in f for f in fails)


def test_validation_reports_broken_playbooks():
    pb = sprinto_playbook()
    pb.icp["signals"][0]["weight"] = 99
    pb.personas.band_order["mid"] = ["nobody"]
    pb.personas.personas[0].title_patterns = ["(unclosed"]
    pb.email.min_words = 200
    errors = validate_playbook(pb)
    joined = " | ".join(errors)
    assert "icp" in joined and "unknown persona 'nobody'" in joined
    assert "not a valid regex" in joined and "word range" in joined


def test_playbook_roundtrips_as_json():
    pb = sprinto_playbook()
    again = Playbook.model_validate_json(pb.model_dump_json())
    assert again == pb and again.rubric_sha256() == pb.rubric_sha256()


def test_pipeline_runs_under_a_playbook_and_a_manual_contact(ctx):
    pb = sprinto_playbook()
    ctx.playbook = pb
    ctx.rubric = pb.loaded_rubric()
    ctx.manual_contact = HunterContact(first_name="Richard", last_name="Hendricks", email="r@acme.test",
                                       position="CEO", source="manual")
    rec = run_one("example.com", ctx)
    poc = next(s for s in rec.stages if s.name == "poc").output
    assert poc["contact"]["source"] == "manual" and "entered manually" in poc["reason"]
    assert rec.rubric["sha256"] == pb.rubric_sha256()
    assert ctx.hunter.calls == [] if hasattr(ctx.hunter, "calls") else True


def test_reviewer_instructions_reach_the_draft_prompt():
    llm = FakeLLM(default_llm_responses())
    build_draft(llm, smart_model="s", fast_model="f", profile=PROFILE, contact=CONTACT,
                playbook=sprinto_playbook(), instructions="mention their payroll launch")
    assert "mention their payroll launch" in llm.calls[-1]["prompt"]
