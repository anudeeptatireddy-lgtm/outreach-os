"""Demo mode: the real pipeline over a synthetic web, with no keys, no network and no sends.

Any domain maps deterministically to one of six company archetypes (a strong fit, a second fit,
a consumer app, an already-certified enterprise, a thin site and a fit with nobody to contact).
`DemoFetcher` serves that company's pages, `DemoHunter` its people and `DemoLLM` answers every
LLM call from the same script, quoting the served pages verbatim, so every validator in the real
engine runs unchanged. The decision trail, scores and emails a demo produces are therefore real
outputs of the engine, only over invented companies.
"""

from __future__ import annotations

import hashlib
import re
from types import SimpleNamespace

from outreach.models import (
    ClaimUsed,
    CompanyProfile,
    DraftLLM,
    EnterpriseCustomer,
    EvidencedBool,
    EvidencedText,
    FocusMention,
    HeadcountFact,
    HiringSignal,
    Link,
    PageResult,
    PainPointSet,
    StageFact,
    ToolReply,
)

ARCHETYPES = ("fit_soc2", "fit_iso", "consumer", "certified_enterprise", "thin", "fit_no_contact")

# Named sample domains always land on the same archetype, so the onboarding sample list shows
# every outcome. Any other domain is hashed onto the four most common archetypes.
SAMPLE_DOMAINS = {
    "ledgerloop.io": "fit_soc2",
    "payrollpilot.com": "fit_iso",
    "claimsbridge.ai": "fit_soc2",
    "fieldnote.dev": "fit_iso",
    "pocketpals.app": "consumer",
    "globalbank-cloud.com": "certified_enterprise",
    "stealthco.xyz": "thin",
    "quietops.io": "fit_no_contact",
}

FIRST_NAMES = ["Priya", "Marcus", "Elena", "Daniel", "Aisha", "Tomas", "Meera", "Jonah", "Sofia", "Ravi"]
LAST_NAMES = ["Raman", "Okafor", "Lindqvist", "Brennan", "Haddad", "Novak", "Iyer", "Whitfield", "Costa", "Menon"]
OFFERINGS = [
    ("accounts payable automation", "automates accounts payable for finance teams at mid-sized companies"),
    ("payroll and benefits software", "runs payroll and benefits for distributed teams in one platform"),
    ("claims processing for insurers", "helps insurance carriers process claims with fewer manual steps"),
    ("customer data infrastructure", "gives product teams a reliable pipeline for customer event data"),
]
FILLER = [
    "Teams use the product every day to keep their work moving without spreadsheets or email chains.",
    "Everything is built around clear roles, approvals and a complete history of every change made.",
    "Our team works across product, engineering and support to ship improvements every single week.",
    "We care about reliability, careful design and support that answers within the same business day.",
    "Customers can start with one workflow and expand across departments as their needs grow over time.",
    "Every plan includes onboarding help, migration support and a named contact for questions.",
]


def archetype_for(domain: str) -> str:
    if domain in SAMPLE_DOMAINS:
        return SAMPLE_DOMAINS[domain]
    h = int(hashlib.sha256(domain.encode()).hexdigest(), 16)
    return ("fit_soc2", "fit_iso", "fit_soc2", "consumer", "certified_enterprise", "fit_iso")[h % 6]


def _h(domain: str, salt: str) -> int:
    return int(hashlib.sha256(f"{salt}:{domain}".encode()).hexdigest(), 16)


def company_name(domain: str) -> str:
    stem = domain.split(".")[0]
    parts = re.split(r"[-_]", stem)
    if len(parts) == 1:
        for suffix in ("loop", "pilot", "bridge", "note", "pals", "ops", "cloud", "co", "ledger", "data"):
            if stem.endswith(suffix) and len(stem) > len(suffix) + 2:
                parts = [stem[: -len(suffix)], suffix]
                break
    return " ".join(p.capitalize() for p in parts if p)


class _Company:
    """The scripted facts for one domain: page texts and the quotes the LLM will cite."""

    def __init__(self, domain: str):
        self.domain = domain
        self.kind = archetype_for(domain)
        self.name = company_name(domain)
        offering_short, offering_long = OFFERINGS[_h(domain, "offer") % len(OFFERINGS)]
        n = self.name
        self.offering = offering_short
        self.facts: dict[str, tuple[str, str]] = {}  # fact key -> (page kind, sentence)
        k = self.kind

        if k == "consumer":
            self.facts["name"] = ("home", f"{n} is a mobile game for kids and families, free to download on every app store.")
            self.facts["b2c"] = ("home", "Parents can set screen time limits and every pet has a story that unfolds as your child plays.")
        elif k == "thin":
            self.facts["name"] = ("home", f"{n} is coming soon.")
        else:
            self.facts["name"] = ("home", f"{n} is a B2B SaaS platform that {offering_long}.")
        if k in ("fit_soc2", "fit_no_contact"):
            self.facts["focus"] = ("security", "We are currently working toward SOC 2 Type II certification so enterprise security reviews move faster.")
            self.facts["hiring"] = ("careers", "We are hiring a Security Engineer to own our compliance program and cloud security posture.")
            self.facts["customers"] = ("customers", "Our customers include Northwind Logistics, Contoso Freight and Globex Manufacturing.")
            self.facts["headcount"] = ("about", "We are a team of about 80 people across two offices.")
            self.facts["stage"] = ("about", "We raised our Series A in 2025 to grow the team.")
        if k == "fit_iso":
            self.facts["focus"] = ("security", "We plan to certify against ISO 27001 this year, and GDPR guides how we handle personal data.")
            self.facts["hiring"] = ("careers", "We are hiring a Compliance Manager to lead our security and privacy program.")
            self.facts["customers"] = ("customers", "Teams at Fabrikam Bank and Tailspin Insurance rely on us for audit trails.")
            self.facts["headcount"] = ("about", "We are a team of about 140 people.")
            self.facts["stage"] = ("about", "We closed our Series B in 2026.")
        if k == "certified_enterprise":
            self.facts["focus"] = ("security", "We hold SOC 2 Type II and ISO 27001 certifications, audited every year.")
            self.facts["headcount"] = ("about", "More than 2,500 employees serve customers in forty countries.")
            self.facts["customers"] = ("customers", "Our customers include Contoso Bank, Woodgrove Financial and Litware Insurance.")

    def page_text(self, kind: str) -> str | None:
        sentences = [s for (pk, s) in self.facts.values() if pk == kind]
        if self.kind == "thin":
            return " ".join(sentences) if kind == "home" else None
        if not sentences and kind not in ("home", "about"):
            return None
        start = _h(self.domain, kind) % len(FILLER)
        filler = [FILLER[(start + i) % len(FILLER)] for i in range(4)]
        heading = {"home": "Home", "about": "About us", "careers": "Careers", "security": "Security",
                   "customers": "Customers", "pricing": "Pricing"}.get(kind, kind.title())
        return f"{self.name} {heading}. " + " ".join(sentences + filler)

    def people(self) -> list[dict]:
        if self.kind in ("fit_no_contact", "thin", "consumer"):
            return [{"value": f"marketing@{self.domain}", "first_name": "Jamie", "last_name": "Lee",
                     "position": "Marketing Manager", "confidence": 70, "seniority": "senior",
                     "verification": {"status": "accept_all"}}] if self.kind == "fit_no_contact" else []
        i = _h(self.domain, "person") % len(FIRST_NAMES)
        j = _h(self.domain, "last") % len(LAST_NAMES)
        lead = {"fit_soc2": "Co-founder and CTO", "fit_iso": "Head of Security",
                "certified_enterprise": "Chief Information Security Officer"}[self.kind]
        first, last = FIRST_NAMES[i], LAST_NAMES[j]
        second = FIRST_NAMES[(i + 3) % len(FIRST_NAMES)]
        return [
            {"value": f"{first.lower()}@{self.domain}", "first_name": first, "last_name": last, "position": lead,
             "confidence": 96, "seniority": "executive", "decision_maker": True, "linkedin": "x",
             "verification": {"status": "valid"}},
            {"value": f"{second.lower()}@{self.domain}", "first_name": second, "last_name": LAST_NAMES[(j + 2) % 10],
             "position": "VP Engineering", "confidence": 88, "seniority": "executive",
             "verification": {"status": "valid"}},
            {"value": f"sales@{self.domain}", "first_name": "Alex", "last_name": "Kim", "position": "Head of Sales",
             "confidence": 91, "seniority": "executive", "verification": {"status": "valid"}},
        ]


def _company(domain: str) -> _Company:
    return _Company(domain)


# --------------------------------------------------------------------------- fetcher / hunter

PATHS = {"about": "/about", "careers": "/careers", "security": "/security", "customers": "/customers",
         "pricing": "/pricing"}


class DemoFetcher:
    def fetch(self, url: str, site: str | None = None) -> PageResult:
        m = re.match(r"^https?://(?:trust\.)?([^/]+)(/[^?#]*)?", url)
        host = (m.group(1) if m else "").lower().removeprefix("www.")
        path = ((m.group(2) if m else "/") or "/").rstrip("/") or "/"
        domain = site or host
        if host.endswith("unreachable.example") or domain.endswith("unreachable.example"):
            return PageResult(url=url, status="error", reason="dns_failure", error="DNS resolution failed")
        company = _company(domain)
        kind = "home" if path == "/" else next((k for k, p in PATHS.items() if p == path), None)
        text = company.page_text(kind) if kind else None
        if text is None:
            return PageResult(url=url, status="unavailable", reason="http_404", error="HTTP 404", final_url=url)
        links = [Link(url=f"https://{domain}{p}", text=k.title()) for k, p in PATHS.items()] if kind == "home" else []
        return PageResult(url=url, status="ok", text=text, chars=len(text), final_url=url, links=links)


class DemoHunter:
    live_calls_this_process = 0

    def domain_search(self, domain: str) -> dict:
        emails = _company(domain).people()
        return {"domain": domain, "from_cache": False, "source": "sample",
                "response": {"data": {"domain": domain, "emails": emails}, "meta": {"results": len(emails)}}}

    def account(self) -> dict:
        return {"plan": "demo", "reset_date": None, "remaining": 999}


# --------------------------------------------------------------------------- LLM

_PAGE = re.compile(r'<page url="([^"]*)" kind="([^"]*)">(.*?)</page>', re.S)


class _ToolSession:
    def send(self, prompt: str) -> ToolReply:
        return ToolReply(text="The pages already fetched answer what can be answered.")

    def respond(self, results) -> ToolReply:
        return ToolReply(text="done")


def _second_person(quote: str) -> str:
    """Quote the prospect's own words back to them: their "we/our" becomes "you/your", so the
    sentence cannot read as a claim by the sender."""
    words = {"we": "you", "our": "your", "us": "you", "we're": "you're", "we've": "you've"}
    out = re.sub(r"\b(We|we|Our|our|Us|us|We're|we're|We've|we've)\b", lambda m: words[m.group(0).lower()], quote)
    return out[0].lower() + out[1:] if out[:1].isupper() and not out.split()[0].isupper() else out


class DemoLLM:
    """Answers every LLM call of the engine from the archetype script."""

    def __init__(self):
        self.stats = SimpleNamespace(api_calls=0, cache_hits=0)

    def start_tool_session(self, **_kw):
        return _ToolSession()

    def generate_structured(self, *, model, system, prompt, schema, purpose, **_kw):
        self.stats.api_calls += 1
        if purpose in ("extract", "research_extract"):
            return self._extract(prompt)
        if purpose == "pain_points":
            return PainPointSet(pain_points=[])  # the playbook's persona pains are used instead
        if purpose == "draft":
            return self._draft(prompt)
        if purpose == "followup":
            return self._followup(prompt, schema)
        if purpose == "playbook_generate":
            from outreach.generate import demo_generated

            return demo_generated(prompt, schema)
        raise ValueError(f"demo mode has no script for {purpose!r}")

    # ---- extraction: quote the served pages verbatim
    def _extract(self, prompt: str) -> CompanyProfile:
        pages = _PAGE.findall(prompt)
        domain = ""
        for url, _kind, _text in pages:
            m = re.match(r"https?://(?:trust\.)?([^/]+)", url)
            if m:
                domain = m.group(1).removeprefix("www.")
                break
        c = _company(domain)

        def cite(key: str):
            if key not in c.facts:
                return None
            sentence = c.facts[key][1]
            for url, _kind, text in pages:
                if sentence in text:
                    return sentence.rstrip("."), url
            return None

        name = cite("name")
        offering = name if c.kind not in ("consumer", "thin") else None
        profile = dict(name=None, offering=None, is_b2b=None, stage=None, headcount=None,
                       focus_mentions=[], hiring_signals=[], enterprise_customers=[])
        if name:
            profile["name"] = EvidencedText(value=c.name, quote=name[0], source_url=name[1])
            if c.kind == "consumer":
                profile["is_b2b"] = EvidencedBool(value=False, quote=name[0], source_url=name[1])
            elif c.kind != "thin":
                profile["is_b2b"] = EvidencedBool(value=True, quote=name[0], source_url=name[1])
        if offering:
            profile["offering"] = EvidencedText(value=c.offering, quote=offering[0], source_url=offering[1])
        hc = cite("headcount")
        if hc:
            value = {"fit_iso": "51-200", "certified_enterprise": "1001+"}.get(c.kind, "51-200")
            profile["headcount"] = HeadcountFact(value=value, quote=hc[0], source_url=hc[1])
        st = cite("stage")
        if st:
            stage = "series_b" if "Series B" in st[0] else "series_a"
            year = re.search(r"20\d\d", st[0])
            profile["stage"] = StageFact(value=stage, as_of=year.group(0) if year else None, quote=st[0], source_url=st[1])
        fo = cite("focus")
        if fo:
            q, u = fo
            if c.kind == "fit_iso":
                profile["focus_mentions"] = [
                    FocusMention(framework="ISO 27001", status="planned", as_of=None, quote="We plan to certify against ISO 27001 this year", source_url=u),
                    FocusMention(framework="GDPR", status="mentioned", as_of=None, quote="GDPR guides how we handle personal data", source_url=u),
                ]
            elif c.kind == "certified_enterprise":
                profile["focus_mentions"] = [
                    FocusMention(framework="SOC 2 Type II", status="certified", as_of=None, quote=q, source_url=u),
                    FocusMention(framework="ISO 27001", status="certified", as_of=None, quote=q, source_url=u),
                ]
            else:
                profile["focus_mentions"] = [FocusMention(framework="SOC 2 Type II", status="in_progress", as_of=None, quote=q, source_url=u)]
        hi = cite("hiring")
        if hi:
            role = "Compliance Manager" if c.kind == "fit_iso" else "Security Engineer"
            profile["hiring_signals"] = [HiringSignal(role=role, quote=hi[0], source_url=hi[1])]
        cu = cite("customers")
        if cu:
            names = re.findall(r"([A-Z][a-z]+ (?:Logistics|Freight|Manufacturing|Bank|Insurance|Financial))", cu[0])
            profile["enterprise_customers"] = [EnterpriseCustomer(name=nm, quote=cu[0], source_url=cu[1]) for nm in names]
        return CompanyProfile(**profile)

    # ---- drafting: a template that respects every validator rule
    def _draft(self, prompt: str) -> DraftLLM:
        first = re.search(r"Recipient first name: (.+)", prompt).group(1).strip()
        evidence = re.findall(r'^(E\d+) \[([^\]]+)\] ([^:]+): "(.*)"$', prompt, re.M)
        claims = re.findall(r"^(S\d): (.+)$", prompt, re.M)
        pains = re.findall(r"^- (.+) \((E\d+)\)$", prompt, re.M)
        guidance = re.search(r"Reviewer guidance for this draft[^\n]*\n(.+)", prompt)
        hook_id, _k, fact, quote = evidence[0]
        hook = _second_person(quote.rstrip("."))
        pain = pains[0][0] if pains else "Work like this tends to land on a small team at the worst moment."
        claim_id, claim = claims[0]
        claim_sentence = claim.rstrip(".") + "."
        claim_sentence = claim_sentence[0].upper() + claim_sentence[1:]
        ask = "Would a short look at how similar teams handle this be useful?"
        if guidance and "call" in guidance.group(1).lower():
            ask = "Would a short call next week be worth it?"
        body = f"Hi {first}, I read on your site that {hook}. {pain} {claim_sentence} {ask}"
        words = body.split()
        if len(words) < 50 and len(evidence) > 1:
            extra = _second_person(evidence[1][3].rstrip("."))
            body = f"Hi {first}, I read on your site that {hook}, and also that {extra}. {pain} {claim_sentence} {ask}"
        if len(body.split()) < 50:
            body = body.replace(ask, "It usually shows up right when the team is busiest. " + ask)
        topic = re.sub(r"\(.*?\)", "", fact).lower()
        topic_words = re.sub(r"[^a-z0-9 ]", "", topic).split()[:2] or ["next", "step"]
        subject = " ".join(["your", *topic_words, "timeline"])
        return DraftLLM(subject=subject, body=body, claims_used=[
            ClaimUsed(claim=hook, evidence_id=hook_id), ClaimUsed(claim=claim, evidence_id=claim_id)])

    def _followup(self, prompt: str, schema):
        first = re.search(r"Recipient first name: (.+)", prompt).group(1).strip()
        angle = re.search(r"Angle for this follow-up: (.+)", prompt)
        claims = re.findall(r"^(S\d): (.+)$", prompt, re.M)
        claim_id, claim = claims[-1]
        claim_sentence = claim.rstrip(".") + "."
        claim_sentence = claim_sentence[0].upper() + claim_sentence[1:]
        closing = "close" in (angle.group(1).lower() if angle else "")
        if closing:
            body = (f"Hi {first}, I will keep this short and not crowd your inbox. If this is not a priority "
                    f"right now, that is completely fine and I will stop here. {claim_sentence} "
                    "Is it worth revisiting later this quarter?")
        else:
            body = (f"Hi {first}, one more thought on my earlier note. When customer reviews pile up, the same "
                    f"questions get answered by hand again and again, usually by the busiest people. "
                    f"{claim_sentence} Would it help to see how other teams take that work off their plate?")
        return schema(body=body, claims_used=[ClaimUsed(claim=claim, evidence_id=claim_id)])
