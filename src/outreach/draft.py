"""Pain points, the draft and the deterministic validator.

The LLM writes; Python decides. A draft is accepted only when `validate_draft` returns no
failures: right first name, 50-90 words, plain text, no URL, no banned phrase, exactly one
question, no number or proper noun that is absent from the evidence pack, and no Sprinto claim
outside the two whitelisted ones. A failing draft is regenerated once with the failures listed,
then the run ends as `rejected_draft`.
"""

from __future__ import annotations

import functools
import re

from outreach.models import (
    ClaimUsed,
    CompanyProfile,
    DraftLLM,
    DraftOutput,
    DraftValidation,
    EmailDraft,
    EvidenceItem,
    HookLink,
    HunterContact,
    PainPoint,
    PainPointSet,
)
from outreach.playbook import Playbook, sprinto_playbook
from outreach.poc import title_category

PAIN_PROMPT_VERSION = "pain.1"
DRAFT_PROMPT_VERSION = "draft.2"

# The ONLY Sprinto claims an email may make.
SPRINTO_WHITELIST: dict[str, str] = {
    "S1": "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR",
    "S2": "continuous monitoring and audit-ready evidence collection",
}

# Footer text. The sender identity and postal address are placeholders by design: fill them in
# before any real send (CAN-SPAM needs a physical address and an opt-out).
SENDER_IDENTITY = "[Sender name], [Title], Sprinto"
SENDER_ADDRESS = "[Sender postal address]"

BANNED_PHRASES = (
    "hope this finds you", "hope this email finds", "hope you're well", "hope you are well",
    "i came across", "i stumbled", "i noticed that you", "quick question", "game-changer",
    "game changer", "revolutionary", "cutting-edge", "cutting edge", "best-in-class",
    "world-class", "synergy", "touch base", "circle back", "reaching out", "following up",
    "follow up", "just checking in", "i wanted to", "are you the right person", "congrats",
    "congratulations", "paradigm", "leverage",
)
NUMBER_WORDS = {
    "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "fifteen", "twenty", "thirty", "fifty", "hundred", "thousand", "million", "billion", "dozen",
    "dozens", "double", "triple", "tenfold",
}

# Persona pain library: used only when the LLM's pain points fail validation.
PERSONA_FOR_CATEGORY = {
    "security_lead": "security", "sec_eng": "security", "compliance": "grc", "it_lead": "it",
    "cofounder_cto": "eng", "cto": "eng", "eng_lead": "eng", "ceo_founder": "founder", "coo": "founder",
}
PAIN_LIBRARY: dict[str, tuple[str, str]] = {
    "founder": (
        "Enterprise deals can stall at the security review when buyers ask for a SOC 2 report.",
        "Founder time goes to security questionnaires and chasing evidence instead of selling.",
    ),
    "eng": (
        "Engineering roadmap time gets pulled into evidence collection, access reviews and policy writing.",
        "A months-long observation window needs controls to hold continuously, with auditor back-and-forth.",
    ),
    "security": (
        "Customers keep asking for proof of security posture through questionnaires and trust requests.",
        "Screenshot-based evidence and spreadsheet tracking let controls drift between audits.",
    ),
    "it": (
        "Onboarding, offboarding and device evidence is scattered across tools and teams.",
        "Access reviews and policy acknowledgements need constant chasing.",
    ),
    "grc": (
        "The same controls get re-mapped across SOC 2, ISO 27001 and GDPR.",
        "Audit prep turns into sprints dominated by evidence chasing.",
    ),
}
ROLE_LINK = {
    "founder": "a founder or executive owns deal speed",
    "eng": "an engineering leader owns roadmap time",
    "security": "a security lead owns posture and evidence",
    "it": "an IT lead owns access and device controls",
    "grc": "a compliance lead owns control mapping and audits",
}

def pain_system(pb: Playbook | None = None) -> str:
    pb = _pb(pb)
    return (
        f"You pick the two most likely {pb.product.problem_space} pain points for one named person "
        "at one company.\n" + _PAIN_RULES
    )


_PAIN_RULES = (
    "Use ONLY the numbered evidence items. Each pain point must be tied to the person's role and to "
    "exactly one evidence id (for example E2). Phrase each as an informed inference, never a "
    "claim about their internals. Return exactly two pain points."
)


def draft_system(pb: Playbook | None = None) -> str:
    pb = _pb(pb)
    name, e = pb.product.name, pb.email
    ids = ", ".join(pb.whitelist)
    text = (
        "You write one short cold email in plain text. Rules, all mandatory:\n"
        f"- {e.min_words} to {e.max_words} words in the body. Plain text only: no links, no markdown, "
        "no HTML, no signature.\n"
        "- Start with 'Hi <first name>,' using exactly the first name given.\n"
        "- One specific hook taken from the numbered evidence items; mention only facts that appear there.\n"
        f"- Then the person's pain in one sentence, then ONE {name} sentence, then ONE small, "
        "interest-based question as the ask. Exactly one question mark in the whole body.\n"
        f"- The only {name} claims allowed are the whitelisted ones, quoted verbatim. No other claims "
        f"about {name}, no statistics, no customers, no numbers that are not in the evidence.\n"
        "- Do not name any person or company that is not in the evidence. No generic openers.\n"
        "- Subject: 2 to 5 words, all lowercase, specific, no company names.\n"
        "- claims_used: one entry per factual statement, with the evidence id (E1..) or the "
        f"{name} claim id ({ids}) it rests on."
    )
    if e.tone.strip():
        text += f"\n- Tone: {e.tone.strip()}"
    return text


@functools.lru_cache(maxsize=1)
def _sprinto() -> Playbook:
    return sprinto_playbook()


def _pb(pb: Playbook | None) -> Playbook:
    return pb if pb is not None else _sprinto()


PAIN_SYSTEM = pain_system(_sprinto())
DRAFT_SYSTEM = draft_system(_sprinto())


# ----------------------------------------------------------------------------- evidence


def build_evidence_pack(profile: CompanyProfile, pb: Playbook | None = None) -> list[EvidenceItem]:
    """Stable ids over the validated profile, in a fixed order (so prompts and caches are stable)."""
    raw: list[tuple[str, str, str, str]] = []
    for m in profile.focus_mentions:
        raw.append((_focus_kind(pb), f"{m.framework} ({m.status})", m.quote, m.source_url))
    for h in profile.hiring_signals:
        raw.append(("hiring", f"hiring {h.role}", h.quote, h.source_url))
    for c in profile.enterprise_customers:
        raw.append(("customer", f"customer {c.name}", c.quote, c.source_url))
    if profile.stage is not None:
        raw.append(("stage", f"stage {profile.stage.value}", profile.stage.quote, profile.stage.source_url))
    if profile.headcount is not None:
        raw.append(("headcount", f"headcount {profile.headcount.value}", profile.headcount.quote, profile.headcount.source_url))
    if profile.offering is not None:
        raw.append(("offering", profile.offering.value, profile.offering.quote, profile.offering.source_url))
    return [
        EvidenceItem(id=f"E{i}", kind=k, fact=f, quote=q, source_url=u)
        for i, (k, f, q, u) in enumerate(raw, start=1)
    ]


def _focus_kind(pb: Playbook | None) -> str:
    return "compliance" if pb is None or pb.template == "sprinto" else "focus"


def _company(profile: CompanyProfile) -> str:
    return profile.name.value if profile.name is not None else "the company"


def _pack_text(pack: list[EvidenceItem]) -> str:
    return "\n".join(f'{e.id} [{e.kind}] {e.fact}: "{e.quote}"' for e in pack) or "(none)"


# ----------------------------------------------------------------------------- pain points


def _persona(contact: HunterContact) -> str:
    return PERSONA_FOR_CATEGORY.get(title_category(contact.position) or "", "founder")


def _persona_pains(contact: HunterContact, pb: Playbook) -> tuple[list[str], str]:
    personas = pb.personas
    pid = title_category(contact.position, personas)
    by_id = personas.by_id()
    persona = by_id.get(pid or "")
    if persona is None:  # an unranked title: use the first persona of the mid band
        mid = personas.band_order.get("mid") or [p.id for p in personas.personas]
        persona = by_id[mid[0]]
    return list(persona.pains[:2]), persona.role_link


def validate_pain_points(points: list[PainPoint], pack: list[EvidenceItem]) -> list[str]:
    ids = {e.id for e in pack}
    problems = []
    if len(points) != 2:
        problems.append(f"expected exactly 2 pain points, got {len(points)}")
    for p in points:
        if p.evidence_id not in ids:
            problems.append(f"pain point cites unknown evidence id {p.evidence_id!r}")
        if not p.pain.strip() or not p.role_link.strip():
            problems.append("pain point missing text or role link")
    return problems


def fallback_pain_points(
    contact: HunterContact, pack: list[EvidenceItem], pb: Playbook | None = None
) -> list[PainPoint]:
    prefer = {"compliance": 0, "focus": 0, "hiring": 1, "customer": 2, "stage": 3, "headcount": 4, "offering": 5}
    ranked = sorted(pack, key=lambda e: (prefer.get(e.kind, 9), e.id))
    cited = [ranked[0].id, (ranked[1] if len(ranked) > 1 else ranked[0]).id]
    if pb is None:
        persona = _persona(contact)
        pains, link = list(PAIN_LIBRARY[persona]), ROLE_LINK[persona]
    else:
        pains, link = _persona_pains(contact, pb)
    return [
        PainPoint(pain=text, role_link=f"{contact.position}: {link}", evidence_id=ev)
        for text, ev in zip(pains, cited)
    ]


def pick_pain_points(
    llm, model: str, profile: CompanyProfile, contact: HunterContact, pack: list[EvidenceItem],
    pb: Playbook | None = None,
) -> tuple[list[PainPoint], str]:
    prompt = (
        f"Person: {contact.first_name} {contact.last_name or ''}, {contact.position}\n"
        f"Company: {_company(profile)}\n<evidence>\n{_pack_text(pack)}\n</evidence>\n\n"
        "Return the two most likely pain points for this role, each with its evidence id."
    )
    try:
        out: PainPointSet = llm.generate_structured(
            model=model, system=pain_system(pb), prompt=prompt, schema=PainPointSet,
            purpose="pain_points", thinking_level="LOW", prompt_version=PAIN_PROMPT_VERSION,
        )
        points = list(out.pain_points)
        if not validate_pain_points(points, pack):
            return points, "llm"
    except (KeyError, ValueError):
        pass  # a schema or lookup miss falls through to the persona library
    return fallback_pain_points(contact, pack, pb), "persona_library"


# ----------------------------------------------------------------------------- validator

_URL = re.compile(r"(https?://|www\.|@\w|\b[\w-]+\.(com|io|ai|co|net|org|dev|app|in|xyz)\b)", re.I)
_MARKUP = re.compile(r"(<\w|\*\*|`|\]\(|^#|^\s*[-*] )", re.M)
_GREETING = re.compile(r"^\s*(hi|hello|hey)\s+([^\s,]+)", re.I)
_PROPER = re.compile(r"\b[A-Z][A-Za-z0-9&'-]*")
_TOKEN = re.compile(r"[A-Za-z0-9&'-]+")


def _tokens(text: str) -> set[str]:
    return {t.lower() for t in _TOKEN.findall(text)}


def _allowed(pack, contact, profile_name, extra="", pb: Playbook | None = None) -> tuple[set[str], set[str]]:
    pb = _pb(pb)
    corpus = " ".join(
        [e.quote + " " + e.fact for e in pack]
        + [profile_name, contact.first_name, contact.last_name or "", contact.position, extra,
           pb.product.name]
        + list(pb.whitelist.values())
    )
    return _tokens(corpus), set(re.findall(r"\d+", corpus))


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def validate_draft(
    draft: DraftLLM,
    contact: HunterContact,
    pack: list[EvidenceItem],
    company: str,
    pb: Playbook | None = None,
    *,
    require_hook: bool = True,
) -> list[str]:
    """Every failed check, as short messages. An empty list means the draft may be sent.
    `require_hook=False` is for follow-ups and human edits that need not cite new evidence."""
    pb = _pb(pb)
    product = pb.product.name
    whitelist = pb.whitelist
    lo, hi = pb.email.min_words, pb.email.max_words
    fails: list[str] = []
    body, subject = draft.body, draft.subject
    allowed_tokens, allowed_numbers = _allowed(pack, contact, company, pb=pb)

    greeting = _GREETING.match(body)
    if greeting is None:
        fails.append("body must start with 'Hi <first name>,'")
    elif greeting.group(2).strip(",.!").lower() != contact.first_name.lower():
        fails.append(f"greeting name {greeting.group(2)!r} differs from Hunter's {contact.first_name!r}")

    words = len(body.split())
    if not lo <= words <= hi:
        fails.append(f"body is {words} words, need {lo} to {hi}")
    sub_words = len(subject.split())
    if not 2 <= sub_words <= 5:
        fails.append(f"subject is {sub_words} words, need 2 to 5")
    if subject != subject.lower():
        fails.append("subject must be lowercase")
    if product.lower() in subject.lower():
        fails.append(f"subject must not name {product}")

    for label, text in (("body", body), ("subject", subject)):
        if _URL.search(text):
            fails.append(f"{label} contains a URL, link or address")
    if _MARKUP.search(body):
        fails.append("body is not plain text (markup found)")

    low = body.lower() + " " + subject.lower()
    for phrase in (*BANNED_PHRASES, *(p.lower() for p in pb.email.extra_banned_phrases if p.strip())):
        if phrase in low:
            fails.append(f"banned phrase: {phrase!r}")
    if body.count("?") != 1:
        fails.append(f"body has {body.count('?')} question marks, need exactly 1")

    for label, text in (("body", body), ("subject", subject)):
        for n in re.findall(r"\d+", text):
            if n not in allowed_numbers:
                fails.append(f"number {n!r} in {label} is not in the evidence or whitelist")
    spelled = {t for t in _tokens(body) if t in NUMBER_WORDS} - allowed_tokens
    for w in sorted(spelled):
        fails.append(f"spelled number {w!r} is not in the evidence")

    for sentence in _sentences(body):
        pos = 0
        for m in _PROPER.finditer(sentence):
            if m.start() == 0 or m.group(0) == "I":
                continue  # sentence-initial words and the pronoun I
            word = m.group(0).lower().strip("'")
            if word not in allowed_tokens and word.rstrip("s") not in allowed_tokens:
                fails.append(f"proper noun {m.group(0)!r} is not in the evidence pack or whitelist")
            pos = m.end()
        norm = re.sub(r"\s+", " ", sentence.lower())
        if re.search(rf"\b{re.escape(product.lower())}\b|\b(we|our|us|we're|we've|we'll)\b", norm):
            if not any(c.lower() in norm for c in whitelist.values()):
                fails.append(f"{product} claim outside the whitelist: {sentence[:60]!r}")

    ids = {e.id: e for e in pack} | {k: None for k in whitelist}
    cited = [c for c in draft.claims_used if c.evidence_id in ids]
    for c in draft.claims_used:
        if c.evidence_id not in ids:
            fails.append(f"claims_used cites unknown id {c.evidence_id!r}")
    evidence_cites = [ids[c.evidence_id] for c in cited if ids[c.evidence_id] is not None]
    if not require_hook:
        return fails
    if not evidence_cites:
        fails.append("no hook cites an evidence item")
    else:
        body_tokens = _tokens(body)
        grounded = any(
            {t for t in _tokens(e.quote + " " + e.fact) if len(t) >= 4} & body_tokens for e in evidence_cites
        )
        if not grounded:
            fails.append("the cited evidence does not appear in the body")
    return fails


def compose_body(core: str, company: str, pb: Playbook | None = None) -> str:
    identity = SENDER_IDENTITY
    if pb is not None:
        identity = f"{pb.email.sender_name}, {pb.email.sender_title}, {pb.product.name}"
    footer = (
        f"--\n{identity}\n{SENDER_ADDRESS}\n"
        f"You are receiving this one-time note because of your role at {company}. "
        'If you would rather not hear from us, reply "no" and I will not email again.'
    )
    return f"{core.rstrip()}\n\n{footer}"


# ----------------------------------------------------------------------------- draft


def _draft_prompt(
    profile, contact, pack, pain_points, failures: list[str] | None,
    pb: Playbook | None = None, instructions: str | None = None,
) -> str:
    pains = "\n".join(f"- {p.pain} ({p.evidence_id})" for p in pain_points)
    wl = "\n".join(f"{k}: {v}" for k, v in _pb(pb).whitelist.items())
    prompt = (
        f"Recipient first name: {contact.first_name}\nRecipient position: {contact.position}\n"
        f"Company: {_company(profile)}\n<evidence>\n{_pack_text(pack)}\n</evidence>\n"
        f"<pain_points>\n{pains}\n</pain_points>\n<value_claims>\n{wl}\n</value_claims>\n\n"
        "Write the email. Return subject, body and claims_used."
    )
    if instructions and instructions.strip():
        prompt += (
            "\n\nReviewer guidance for this draft (follow it unless it breaks a rule above):\n"
            + instructions.strip()[:500]
        )
    if failures:
        prompt += "\n\nYour previous draft failed these checks. Fix every one:\n" + "\n".join(
            f"- {f}" for f in failures
        )
    return prompt


def build_draft(
    llm,
    *,
    smart_model: str,
    fast_model: str,
    profile: CompanyProfile,
    contact: HunterContact,
    playbook: Playbook | None = None,
    instructions: str | None = None,
) -> DraftOutput:
    pb = playbook
    pack = build_evidence_pack(profile, pb)
    company = _company(profile)
    if not pack:
        empty = EmailDraft(subject="", body="")
        return DraftOutput(
            draft=empty, greets_by_first_name=False, evidence_pack=pack,
            validation=DraftValidation(ok=False, failures=["no evidence items to cite"], attempts=0),
        )
    pains, source = pick_pain_points(llm, fast_model, profile, contact, pack, pb)

    failures: list[str] = []
    attempt_failures: list[list[str]] = []
    result: DraftLLM | None = None
    for attempt in (1, 2):
        result = llm.generate_structured(
            model=smart_model, system=draft_system(pb),
            prompt=_draft_prompt(profile, contact, pack, pains, failures or None, pb, instructions),
            schema=DraftLLM, purpose="draft", thinking_level="LOW",
            prompt_version=DRAFT_PROMPT_VERSION,
        )
        failures = validate_draft(result, contact, pack, company, pb)
        attempt_failures.append(failures)
        if not failures:
            break

    assert result is not None
    by_id = {e.id: e for e in pack}
    claims = list(result.claims_used)
    for sid, text in _pb(pb).whitelist.items():
        if text.lower() in result.body.lower() and not any(c.evidence_id == sid for c in claims):
            claims.append(ClaimUsed(claim=text, evidence_id=sid))
    hook_map = [
        HookLink(claim=c.claim, evidence_id=c.evidence_id, quote=by_id[c.evidence_id].quote,
                 source_url=by_id[c.evidence_id].source_url)
        for c in claims if c.evidence_id in by_id
    ]
    greets = contact.first_name in result.body[:40]
    return DraftOutput(
        draft=EmailDraft(subject=result.subject, body=compose_body(result.body, company, pb)),
        greets_by_first_name=greets,
        core_body=result.body,
        claims_used=claims,
        pain_points=pains,
        pain_points_source=source,
        hook_map=hook_map,
        evidence_pack=pack,
        validation=DraftValidation(
            ok=not failures, failures=failures, attempts=len(attempt_failures),
            attempt_failures=attempt_failures,
        ),
    )
