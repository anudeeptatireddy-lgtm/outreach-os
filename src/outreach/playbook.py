"""Playbooks: everything that makes the pipeline specific to one product.

A playbook holds what you sell (product and the only claims an email may make), what to look
for on a prospect's site (the research focus), the ICP rubric, who to contact (personas ranked
per company-size band) and the email rules. The engine is product-agnostic; it reads these
values instead of constants. `sprinto_playbook()` reproduces the original Sprinto behaviour
exactly (its rubric is the hashed `config/icp.toml`), and `blank_playbook()` is a neutral
starting point for any other B2B product.

Playbooks are plain JSON-able Pydantic models so the web app can store and edit them.
"""

from __future__ import annotations

import hashlib
import json
import re
import tomllib
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

DEFAULT_RUBRIC_PATH = Path(__file__).resolve().parents[2] / "config" / "icp.toml"

Band = Literal["small", "mid", "large"]


class Product(BaseModel):
    name: str
    one_liner: str = ""
    website: str = ""
    problem_space: str = ""  # e.g. "compliance"; drives the pain-point prompt


class ValueClaim(BaseModel):
    id: str
    text: str


class ResearchFocus(BaseModel):
    focus_label: str = "Focus topics"
    focus_description: str = ""


class Persona(BaseModel):
    id: str
    label: str
    title_patterns: list[str]
    pains: list[str] = Field(default_factory=list)  # exactly two, used when the LLM pains fail
    role_link: str = ""


class Personas(BaseModel):
    personas: list[Persona]
    band_order: dict[str, list[str]]
    exclude_title_keywords: list[str] = Field(default_factory=list)

    def by_id(self) -> dict[str, Persona]:
        return {p.id: p for p in self.personas}


class EmailRules(BaseModel):
    min_words: int = 50
    max_words: int = 90
    tone: str = ""
    extra_banned_phrases: list[str] = Field(default_factory=list)
    sender_name: str = "[Sender name]"
    sender_title: str = "[Title]"
    followup_angles: list[str] = Field(default_factory=list)


class Playbook(BaseModel):
    name: str
    template: str | None = None
    product: Product
    value_claims: list[ValueClaim]
    research: ResearchFocus
    icp: dict  # the rubric, same schema as config/icp.toml (see outreach.qualify.Rubric)
    personas: Personas
    email: EmailRules = Field(default_factory=EmailRules)

    @property
    def whitelist(self) -> dict[str, str]:
        return {c.id: c.text for c in self.value_claims}

    def rubric_sha256(self) -> str:
        return hashlib.sha256(json.dumps(self.icp, sort_keys=True).encode()).hexdigest()

    def loaded_rubric(self):
        """The rubric as the qualifier expects it, hashed over its canonical JSON."""
        from outreach.qualify import LoadedRubric, Rubric, _validate

        rubric = Rubric.model_validate(self.icp)
        _validate(rubric)
        return LoadedRubric(rubric=rubric, sha256=self.rubric_sha256(), path=Path(f"playbook:{self.name}"))


# --------------------------------------------------------------------------- validation

_CLAIM_ID = re.compile(r"^S[1-9]$")


def validate_playbook(pb: Playbook) -> list[str]:
    """Every problem that would make the pipeline misbehave, as short messages."""
    from outreach.qualify import RubricError, Rubric, _validate

    errors: list[str] = []
    if not pb.name.strip():
        errors.append("name is required")
    if not pb.product.name.strip():
        errors.append("product.name is required")
    if not pb.product.problem_space.strip():
        errors.append("product.problem_space is required (for example: compliance)")

    ids = [c.id for c in pb.value_claims]
    if not 1 <= len(ids) <= 5:
        errors.append("value_claims needs between 1 and 5 claims")
    if len(set(ids)) != len(ids):
        errors.append("value claim ids must be unique")
    for c in pb.value_claims:
        if not _CLAIM_ID.match(c.id):
            errors.append(f"value claim id {c.id!r} must look like S1..S9")
        if len(c.text.split()) < 3:
            errors.append(f"value claim {c.id} is too short to be a sentence")

    try:
        _validate(Rubric.model_validate(pb.icp))
    except ValidationError as exc:
        for e in exc.errors()[:8]:
            errors.append("icp." + ".".join(str(x) for x in e["loc"]) + ": " + e["msg"])
    except RubricError as exc:
        errors.append(f"icp: {exc}")

    known = pb.personas.by_id()
    if len(known) != len(pb.personas.personas):
        errors.append("persona ids must be unique")
    for p in pb.personas.personas:
        if not p.title_patterns:
            errors.append(f"persona {p.id} needs at least one title pattern")
        for pat in p.title_patterns:
            try:
                re.compile(pat)
            except re.error as exc:
                errors.append(f"persona {p.id}: title pattern {pat!r} is not a valid regex ({exc})")
        if len(p.pains) != 2 or any(not s.strip() for s in p.pains):
            errors.append(f"persona {p.id} needs exactly two pains")
    for band in ("small", "mid", "large"):
        order = pb.personas.band_order.get(band)
        if not order:
            errors.append(f"personas.band_order.{band} needs at least one persona")
            continue
        for pid in order:
            if pid not in known:
                errors.append(f"personas.band_order.{band} names unknown persona {pid!r}")

    e = pb.email
    if not 20 <= e.min_words < e.max_words <= 250:
        errors.append("email word range must satisfy 20 <= min_words < max_words <= 250")
    return errors


# --------------------------------------------------------------------------- templates

SPRINTO_PERSONAS = Personas(
    personas=[
        Persona(
            id="security_lead", label="Security lead (CISO, Head of Security)",
            title_patterns=[r"\bciso\b", r"chief (information )?security",
                            r"(head|director|vp|vice president|lead) (of )?(information )?security",
                            r"security (director|head|lead)"],
            pains=["Customers keep asking for proof of security posture through questionnaires and trust requests.",
                   "Screenshot-based evidence and spreadsheet tracking let controls drift between audits."],
            role_link="a security lead owns posture and evidence",
        ),
        Persona(
            id="compliance", label="Compliance / GRC lead",
            title_patterns=[r"\bgrc\b", r"compliance", r"\bgovernance\b"],
            pains=["The same controls get re-mapped across SOC 2, ISO 27001 and GDPR.",
                   "Audit prep turns into sprints dominated by evidence chasing."],
            role_link="a compliance lead owns control mapping and audits",
        ),
        Persona(
            id="cofounder_cto", label="Technical co-founder / CTO",
            title_patterns=[r"(co-?founder|technical founder).*\bcto\b", r"\bcto\b.*co-?founder",
                            r"technical co-?founder"],
            pains=["Engineering roadmap time gets pulled into evidence collection, access reviews and policy writing.",
                   "A months-long observation window needs controls to hold continuously, with auditor back-and-forth."],
            role_link="an engineering leader owns roadmap time",
        ),
        Persona(
            id="cto", label="CTO",
            title_patterns=[r"\bcto\b", r"chief technology", r"chief technical"],
            pains=["Engineering roadmap time gets pulled into evidence collection, access reviews and policy writing.",
                   "A months-long observation window needs controls to hold continuously, with auditor back-and-forth."],
            role_link="an engineering leader owns roadmap time",
        ),
        Persona(
            id="eng_lead", label="VP / Head of Engineering",
            title_patterns=[r"(vp|vice president|head|director) (of )?engineering",
                            r"engineering (director|head|lead)", r"\bvp eng\b"],
            pains=["Engineering roadmap time gets pulled into evidence collection, access reviews and policy writing.",
                   "A months-long observation window needs controls to hold continuously, with auditor back-and-forth."],
            role_link="an engineering leader owns roadmap time",
        ),
        Persona(
            id="ceo_founder", label="CEO / Founder",
            title_patterns=[r"\bceo\b", r"chief executive", r"\bfounder\b", r"co-?founder", r"\bowner\b",
                            r"\bpresident\b"],
            pains=["Enterprise deals can stall at the security review when buyers ask for a SOC 2 report.",
                   "Founder time goes to security questionnaires and chasing evidence instead of selling."],
            role_link="a founder or executive owns deal speed",
        ),
        Persona(
            id="it_lead", label="Head of IT",
            title_patterns=[r"(head|director|vp|vice president|manager) (of )?(it|information technology)\b",
                            r"\bit (manager|director|head)\b"],
            pains=["Onboarding, offboarding and device evidence is scattered across tools and teams.",
                   "Access reviews and policy acknowledgements need constant chasing."],
            role_link="an IT lead owns access and device controls",
        ),
        Persona(
            id="coo", label="COO / Head of Operations",
            title_patterns=[r"\bcoo\b", r"chief operating", r"(head|director|vp) (of )?operations"],
            pains=["Enterprise deals can stall at the security review when buyers ask for a SOC 2 report.",
                   "Founder time goes to security questionnaires and chasing evidence instead of selling."],
            role_link="a founder or executive owns deal speed",
        ),
        Persona(
            id="sec_eng", label="Security engineer / manager",
            title_patterns=[r"security (engineer|manager)", r"(senior|staff|principal) security"],
            pains=["Customers keep asking for proof of security posture through questionnaires and trust requests.",
                   "Screenshot-based evidence and spreadsheet tracking let controls drift between audits."],
            role_link="a security lead owns posture and evidence",
        ),
    ],
    band_order={
        "small": ["security_lead", "cofounder_cto", "cto", "ceo_founder", "eng_lead", "coo", "it_lead", "compliance"],
        "mid": ["security_lead", "eng_lead", "it_lead", "compliance", "cofounder_cto", "cto", "coo", "ceo_founder"],
        "large": ["security_lead", "compliance", "it_lead", "eng_lead", "cto", "cofounder_cto", "sec_eng"],
    },
    exclude_title_keywords=[
        "sales", "marketing", "hr", "human resources", "recruit", "talent", "people", "customer success",
        "customer support", "support", "finance", "financial", "cfo", "intern", "advisor", "adviser",
        "board", "revenue", "growth", "business development", "partnership", "account executive",
        "brand", "content", "legal", "counsel", "design", "product marketing", "community",
    ],
)


@lru_cache(maxsize=1)
def _sprinto_icp() -> str:
    return json.dumps(tomllib.loads(DEFAULT_RUBRIC_PATH.read_text("utf-8")))


def sprinto_playbook() -> Playbook:
    """The original Sprinto behaviour as a playbook (rubric icp.2 from config/icp.toml)."""
    return Playbook(
        name="Sprinto: SOC 2 / ISO 27001 / GDPR",
        template="sprinto",
        product=Product(
            name="Sprinto",
            one_liner="Compliance automation for SOC 2, ISO 27001 and GDPR",
            website="https://sprinto.com",
            problem_space="compliance",
        ),
        value_claims=[
            ValueClaim(id="S1", text="Sprinto automates compliance for SOC 2, ISO 27001 and GDPR"),
            ValueClaim(id="S2", text="continuous monitoring and audit-ready evidence collection"),
        ],
        research=ResearchFocus(
            focus_label="Compliance frameworks",
            focus_description=(
                "security and privacy compliance frameworks or certifications the company holds, is "
                "working toward, plans, or mentions, such as SOC 2 (Type I or II), ISO 27001, GDPR, "
                "HIPAA or PCI DSS. framework is the framework's name."
            ),
        ),
        icp=json.loads(_sprinto_icp()),
        personas=SPRINTO_PERSONAS.model_copy(deep=True),
        email=EmailRules(
            min_words=50, max_words=90,
            tone="Peer-to-peer and specific. One observation, one pain, one product sentence, one small question.",
            sender_name="[Sender name]", sender_title="[Title]",
            followup_angles=[
                "Bump the first note with a different angle: the cost of security questionnaires in enterprise deals.",
                "Short close-the-loop note: ask whether compliance is a priority this quarter, and offer to stop.",
            ],
        ),
    )


def blank_playbook(name: str = "New playbook") -> Playbook:
    """A neutral B2B starting point. Weights sum to 100; edit the product, focus and personas."""
    icp = {
        "version": "custom.1",
        "description": "B2B companies likely to need the product now",
        "thresholds": {"qualify_min": 60, "reject_max": 40, "reference_year": 2026,
                       "unknown_credit": 0.5, "qualify_expected": 55},
        "gates": [
            {"id": "G1_b2b", "label": "Sells to businesses", "field": "is_b2b", "fail_values": [False]},
        ],
        "signals": [
            {"id": "b2b", "label": "B2B product", "group": "A", "weight": 15, "kind": "map", "field": "is_b2b",
             "points": {"true": 15, "false": 0}, "target_kinds": ["home", "pricing", "about"]},
            {"id": "headcount_band", "label": "Headcount band", "group": "A", "weight": 10, "kind": "map",
             "field": "headcount", "target_kinds": ["about", "careers"],
             "points": {"11-50": 8, "51-200": 10, "201-500": 8, "501-1000": 5, "1-10": 3, "1001+": 2}},
            {"id": "funding_stage", "label": "Funding stage", "group": "A", "weight": 5, "kind": "map",
             "field": "stage", "target_kinds": ["about"],
             "points": {"seed": 3, "series_a": 5, "series_b": 5, "series_c": 4, "series_d_or_later": 2,
                        "public": 1, "bootstrapped": 3, "pre_seed": 1}},
            {"id": "focus_signal", "label": "Shows the problem your product solves", "group": "B", "weight": 30,
             "kind": "best", "field": "focus_mentions", "attribute": "status",
             "target_kinds": ["home", "about"],
             "points": {"in_progress": 30, "planned": 30, "mentioned": 15, "certified": 5}},
            {"id": "enterprise_customers", "label": "Named customers", "group": "B", "weight": 20, "kind": "count",
             "field": "enterprise_customers", "tiers": [[3, 20], [2, 13], [1, 7]],
             "target_kinds": ["customers"]},
            {"id": "relevant_hiring", "label": "Hiring for roles your product helps", "group": "B", "weight": 20,
             "kind": "keyword", "field": "hiring_signals", "attribute": "role", "target_kinds": ["careers"],
             "keyword_groups": [{"points": 20, "keywords": ["operations", "engineering"]},
                                {"points": 8, "keywords": ["manager", "lead"]}]},
        ],
        "penalties": [],
    }
    return Playbook(
        name=name,
        template="blank",
        product=Product(name="Your product", one_liner="", website="", problem_space="operations"),
        value_claims=[ValueClaim(id="S1", text="Your product helps teams solve the core problem faster")],
        research=ResearchFocus(
            focus_label="Problem signals",
            focus_description=(
                "tools, initiatives or problems the page names that your product addresses. framework is "
                "the tool or initiative name; status certified means already in place, in_progress means "
                "underway, planned means announced, mentioned otherwise."
            ),
        ),
        icp=icp,
        personas=Personas(
            personas=[
                Persona(id="ceo_founder", label="CEO / Founder",
                        title_patterns=[r"\bceo\b", r"chief executive", r"\bfounder\b", r"co-?founder"],
                        pains=["Leadership time goes to work that should run itself.",
                               "Growth exposes processes that do not scale."],
                        role_link="a founder owns growth and focus"),
                Persona(id="cto", label="CTO / VP Engineering",
                        title_patterns=[r"\bcto\b", r"chief technology", r"(vp|head|director) (of )?engineering"],
                        pains=["Roadmap time gets pulled into internal tooling.",
                               "Systems built for an earlier stage start to creak."],
                        role_link="an engineering leader owns roadmap time"),
                Persona(id="coo", label="COO / Head of Operations",
                        title_patterns=[r"\bcoo\b", r"chief operating", r"(head|director|vp) (of )?operations"],
                        pains=["Manual handoffs slow every team down.",
                               "Visibility across teams depends on spreadsheets."],
                        role_link="an operations leader owns how work gets done"),
            ],
            band_order={"small": ["ceo_founder", "cto", "coo"], "mid": ["coo", "cto", "ceo_founder"],
                        "large": ["coo", "cto"]},
            exclude_title_keywords=["intern", "advisor", "board", "recruit", "talent"],
        ),
        email=EmailRules(followup_angles=["A different angle on the same problem.",
                                          "Short close-the-loop note."]),
    )


TEMPLATES = {
    "sprinto": ("Sprinto (SOC 2, ISO 27001, GDPR)",
                "The flagship playbook: compliance automation for SaaS companies, Series A to C."),
    "blank": ("Blank B2B playbook", "A neutral starting point for any B2B product."),
}


def from_template(key: str) -> Playbook:
    if key == "sprinto":
        return sprinto_playbook()
    if key == "blank":
        return blank_playbook()
    raise KeyError(key)
