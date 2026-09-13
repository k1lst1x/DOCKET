"""Structured outputs, claim verification and storage for the generation pipeline.

Models cite evidence by the numbers ([n]) the researcher's evidence registry assigned; code maps those
numbers to chunk ids. Verification has two independent layers: the verifier agent judges whether the
cited text supports each claim, and code requires every number, amount, date, address, section and
record id to appear verbatim in the cited chunks. Only claims that pass both are stored.
"""

import re
from dataclasses import dataclass, field
from typing import Literal

from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from core.citations import enforce
from core.db import connect, run_with_retry
from core.retrieval import Evidence

SUMMARY_WORD_LIMIT = 200


class CitedClaim(BaseModel):
    text: str = Field(description="One plain-language sentence, no untranslated municipal jargon.")
    refs: list[int] = Field(description="Evidence numbers whose text supports this sentence.")


class VisualPoint(BaseModel):
    label: str = Field(description="What the value measures, taken from the evidence.")
    value: str = Field(description="Copied exactly from the evidence, e.g. '$396,000' or '9/8/2026'.")
    refs: list[int]


class Visual(BaseModel):
    kind: Literal["bar", "pie", "timeline", "facts"] = Field(
        description=(
            "bar or pie only for numbers from the evidence; timeline for cited dates; facts otherwise."
        )
    )
    title: str
    points: list[VisualPoint]


class SummaryOutput(BaseModel):
    headline: str
    claims: list[CitedClaim]
    visual: Visual | None = None


class ProsConsPoint(BaseModel):
    text: str
    refs: list[int]
    basis: Literal["stated in the document", "reasonable inference"]


class ProsConsOutput(BaseModel):
    pros: list[ProsConsPoint]
    cons: list[ProsConsPoint]
    one_sided_note: str | None = Field(
        default=None,
        description="Say plainly when the evidence supports only one side; never invent balance.",
    )


class ClaimVerdict(BaseModel):
    claim_id: str
    supported: bool
    reason: str


class VerificationOutput(BaseModel):
    verdicts: list[ClaimVerdict]


@dataclass
class CandidateClaim:
    claim_id: str
    section: Literal["summary", "pro", "con", "visual"]
    text: str
    refs: list[int]
    basis: str | None = None
    label: str | None = None
    value: str | None = None


@dataclass
class VerifiedOutput:
    body: dict
    claims: list[tuple[str, list[str]]]  # (claim text, chunk ids)
    stripped: list[dict] = field(default_factory=list)


def candidate_claims(summary: SummaryOutput | None, proscons: ProsConsOutput | None) -> list[CandidateClaim]:
    candidates: list[CandidateClaim] = []
    if summary:
        candidates += [
            CandidateClaim(f"s{i}", "summary", c.text, c.refs) for i, c in enumerate(summary.claims, 1)
        ]
        if summary.visual:
            candidates += [
                CandidateClaim(
                    f"v{i}", "visual", f"{p.label}: {p.value}", p.refs, label=p.label, value=p.value
                )
                for i, p in enumerate(summary.visual.points, 1)
            ]
    if proscons:
        candidates += [
            CandidateClaim(f"p{i}", "pro", p.text, p.refs, p.basis) for i, p in enumerate(proscons.pros, 1)
        ]
        candidates += [
            CandidateClaim(f"c{i}", "con", c.text, c.refs, c.basis) for i, c in enumerate(proscons.cons, 1)
        ]
    return candidates


def check_facts(
    claim: CandidateClaim, evidence_by_ref: dict[int, Evidence]
) -> tuple[bool, list[str], list[str]]:
    """Code-level check: returns (passes, unsupported facts, cited texts)."""
    cited = [evidence_by_ref[ref].cited_text() for ref in claim.refs if ref in evidence_by_ref]
    if not cited:
        return False, ["no valid evidence number cited"], []
    if claim.section == "visual" and claim.value is not None:
        # A chart value must itself appear in the cited text, not just any fact in the label.
        if re.sub(r"\s+", " ", claim.value.casefold()) not in re.sub(r"\s+", " ", " ".join(cited).casefold()):
            return False, [claim.value], cited
    result = enforce(claim.text, cited)
    return not result.removed, [value for removal in result.removed for value in removal.unsupported], cited


def _citations(refs: list[int], evidence_by_ref: dict[int, Evidence]) -> list[dict]:
    return [
        {
            "chunk_id": evidence_by_ref[ref].chunk_id,
            "title": evidence_by_ref[ref].title,
            "url": evidence_by_ref[ref].url,
            "locator": evidence_by_ref[ref].locator,
        }
        for ref in refs
        if ref in evidence_by_ref
    ]


def assemble_verified(
    kind: str,
    topic: str,
    summary: SummaryOutput | None,
    proscons: ProsConsOutput | None,
    verdicts: dict[str, ClaimVerdict],
    evidence_by_ref: dict[int, Evidence],
) -> VerifiedOutput:
    """Keep only claims the verifier supported AND whose facts appear verbatim in the cited evidence."""
    kept: dict[str, CandidateClaim] = {}
    stripped = []
    for claim in candidate_claims(summary, proscons):
        facts_ok, unsupported, _ = check_facts(claim, evidence_by_ref)
        verdict = verdicts.get(claim.claim_id)
        if facts_ok and verdict and verdict.supported:
            kept[claim.claim_id] = claim
        else:
            stripped.append(
                {
                    "claim_id": claim.claim_id,
                    "text": claim.text,
                    "unsupported_facts": unsupported,
                    "verifier": verdict.reason if verdict else "no verdict",
                }
            )

    claims: list[tuple[str, list[str]]] = []
    body: dict = {"topic": topic, "kind": kind}
    if kind in ("summary", "announcement"):
        words = 0
        body_claims = []
        for claim in (c for c in kept.values() if c.section == "summary"):
            words += len(claim.text.split())
            if words > SUMMARY_WORD_LIMIT:
                stripped.append({"claim_id": claim.claim_id, "text": claim.text, "reason": "over 200 words"})
                continue
            body_claims.append({"text": claim.text, "citations": _citations(claim.refs, evidence_by_ref)})
            claims.append((claim.text, [c["chunk_id"] for c in body_claims[-1]["citations"]]))
        cited_texts = [
            evidence_by_ref[r].cited_text() for c in kept.values() for r in c.refs if r in evidence_by_ref
        ]
        headline = summary.headline if summary else topic
        body["headline"] = headline if cited_texts and not enforce(headline, cited_texts).removed else topic
        body["claims"] = body_claims
        visual_points = [c for c in kept.values() if c.section == "visual"]
        if summary and summary.visual and visual_points:
            body["visual"] = {
                "kind": summary.visual.kind,
                "title": summary.visual.title,
                "points": [
                    {"label": p.label, "value": p.value, "citations": _citations(p.refs, evidence_by_ref)}
                    for p in visual_points
                ],
            }
    if kind == "proscons":
        for section, key in (("pro", "pros"), ("con", "cons")):
            points = []
            for claim in (c for c in kept.values() if c.section == section):
                citations = _citations(claim.refs, evidence_by_ref)
                points.append({"text": claim.text, "basis": claim.basis, "citations": citations})
                claims.append((claim.text, [c["chunk_id"] for c in citations]))
            body[key] = points
        if not body["pros"] or not body["cons"]:
            one_side = "pros" if body["pros"] else "cons" if body["cons"] else None
            body["one_sided_note"] = (
                f"The evidence supports only {one_side}; nothing in the sources supports the other side."
                if one_side
                else "The evidence supports neither side."
            )
        elif proscons and proscons.one_sided_note:
            body["one_sided_note"] = proscons.one_sided_note
    return VerifiedOutput(body=body, claims=claims, stripped=stripped)


def store_output(kind: str, topic: str, group_id: str | None, verified: VerifiedOutput) -> str:
    """Writes one verified output with its claims and claim-to-chunk links in a single transaction."""

    def work(c):
        output_id = c.execute(
            "INSERT INTO agent_outputs (kind, topic, group_id, body_json, status) "
            "VALUES (%s, %s, %s, %s, 'verified') RETURNING id",
            (kind, topic, group_id, Jsonb(verified.body)),
        ).fetchone()[0]
        for text, chunk_ids in verified.claims:
            claim_id = c.execute(
                "INSERT INTO agent_claims (output_id, claim_text, verified_bool) "
                "VALUES (%s, %s, true) RETURNING id",
                (output_id, text),
            ).fetchone()[0]
            for chunk_id in dict.fromkeys(chunk_ids):
                c.execute(
                    "INSERT INTO agent_claim_chunks (claim_id, chunk_id) VALUES (%s, %s::uuid)",
                    (claim_id, chunk_id),
                )
        return str(output_id)

    with connect() as conn:
        conn.autocommit = False
        return run_with_retry(conn, work)
