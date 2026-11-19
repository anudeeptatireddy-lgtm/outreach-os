"""Follow-up emails: short, threaded replies to the first email, validated like the first.

A follow-up is sent in the same thread (Re: the original subject, with In-Reply-To headers set
by the mailer), so the subject is not regenerated. The body goes through the same deterministic
validator as a first email, with a shorter word range and without the evidence-hook requirement:
the first email already carried the hook. Product claims are still limited to the whitelist.
"""

from __future__ import annotations

from pydantic import BaseModel

from outreach.draft import BANNED_PHRASES, _company, _pb, build_evidence_pack, validate_draft
from outreach.models import ClaimUsed, CompanyProfile, DraftLLM, DraftValidation, HunterContact
from outreach.playbook import Playbook

FOLLOWUP_PROMPT_VERSION = "followup.1"
FOLLOWUP_MIN_WORDS = 25
FOLLOWUP_MAX_WORDS = 75


class FollowupLLM(BaseModel):
    body: str
    claims_used: list[ClaimUsed]


class FollowupOutput(BaseModel):
    subject: str
    body: str
    claims_used: list[ClaimUsed]
    validation: DraftValidation


def followup_system(pb: Playbook | None = None) -> str:
    pb = _pb(pb)
    name = pb.product.name
    return (
        "You write one short follow-up to a cold email that got no reply, in plain text. Rules:\n"
        f"- {FOLLOWUP_MIN_WORDS} to {FOLLOWUP_MAX_WORDS} words. No links, no markdown, no signature.\n"
        "- Start with 'Hi <first name>,' using exactly the first name given.\n"
        "- Take the angle given. Do not repeat the first email. Do not guilt-trip or fake urgency.\n"
        f"- At most ONE {name} sentence, and only a whitelisted claim quoted verbatim.\n"
        "- Mention only facts from the evidence items. No numbers or names that are not there.\n"
        "- Exactly one question mark.\n"
        "- claims_used: the evidence ids (E1..) or claim ids (S1..) your statements rest on."
    )


def _rules(pb: Playbook) -> Playbook:
    short = pb.model_copy(deep=True)
    short.email.min_words = FOLLOWUP_MIN_WORDS
    short.email.max_words = min(FOLLOWUP_MAX_WORDS, max(pb.email.max_words, FOLLOWUP_MAX_WORDS))
    return short


def build_followup(
    llm,
    *,
    model: str,
    playbook: Playbook | None,
    profile: CompanyProfile,
    contact: HunterContact,
    first_subject: str,
    previous_bodies: list[str],
    step: int,
) -> FollowupOutput:
    pb = _pb(playbook)
    pack = build_evidence_pack(profile, playbook)
    company = _company(profile)
    angles = pb.email.followup_angles or ["A different angle on the same problem."]
    angle = angles[min(step - 1, len(angles) - 1)]
    wl = "\n".join(f"{k}: {v}" for k, v in pb.whitelist.items())
    ev = "\n".join(f'{e.id} [{e.kind}] {e.fact}: "{e.quote}"' for e in pack) or "(none)"
    earlier = "\n---\n".join(b.split("\n--\n")[0] for b in previous_bodies)
    base_prompt = (
        f"Recipient first name: {contact.first_name}\nRecipient position: {contact.position}\n"
        f"Company: {company}\nFollow-up number: {step}\nAngle for this follow-up: {angle}\n"
        f"<evidence>\n{ev}\n</evidence>\n<value_claims>\n{wl}\n</value_claims>\n"
        f"<earlier_emails>\n{earlier}\n</earlier_emails>\n\nWrite the follow-up body."
    )
    rules = _rules(pb)
    subject = first_subject if first_subject.lower().startswith("re:") else f"Re: {first_subject}"
    failures: list[str] = []
    attempts: list[list[str]] = []
    out: FollowupLLM | None = None
    for _ in (1, 2):
        prompt = base_prompt
        if failures:
            prompt += "\n\nYour previous attempt failed these checks. Fix every one:\n" + "\n".join(
                f"- {f}" for f in failures
            )
        out = llm.generate_structured(
            model=model, system=followup_system(pb), prompt=prompt, schema=FollowupLLM,
            purpose="followup", thinking_level="LOW", prompt_version=FOLLOWUP_PROMPT_VERSION,
        )
        as_draft = DraftLLM(subject=first_subject, body=out.body, claims_used=out.claims_used)
        failures = validate_draft(as_draft, contact, pack, company, rules, require_hook=False)
        attempts.append(failures)
        if not failures:
            break
    assert out is not None
    return FollowupOutput(
        subject=subject,
        body=out.body,
        claims_used=list(out.claims_used),
        validation=DraftValidation(ok=not failures, failures=failures, attempts=len(attempts),
                                   attempt_failures=attempts),
    )


__all__ = ["BANNED_PHRASES", "FollowupOutput", "build_followup", "followup_system"]
