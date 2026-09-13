"""Citation enforcement in code: every fact in generated text must appear verbatim in cited evidence.

Extracts dollar amounts, dates, code section references, record ids (case, permit and request
numbers), street addresses and bare numbers from generated text. A sentence containing any fact
that does not appear verbatim in at least one cited chunk is removed, and the removal is logged.
Matching is verbatim after light normalization only: case, whitespace, markdown emphasis and
thousands separators. "September 8, 2026" does not match "9/8/2026".
"""

import logging
import re
from dataclasses import dataclass, field

log = logging.getLogger("docket.citations")

MONTH = (
    r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|"
    r"Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?"
)

# Order matters: specific kinds are matched and masked before bare numbers.
FACT_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("dollar", re.compile(r"\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand))?", re.IGNORECASE)),
    (
        "date",
        re.compile(
            rf"\b{MONTH}\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+\d{{4}}\b|\b\d{{1,2}}/\d{{1,2}}/\d{{2,4}}\b"
            rf"|\b\d{{4}}-\d{{2}}-\d{{2}}\b|\b{MONTH}\s+\d{{4}}\b"
        ),
    ),
    (
        "section",
        re.compile(r"(?:§§?\s?|\b(?:Section|Sec\.)\s+)\d+(?:[.\-]\d+)*(?:\([a-z0-9]+\))*", re.IGNORECASE),
    ),
    ("record_id", re.compile(r"\b[A-Z]{2,5}-?\d{2,6}(?:-[A-Z0-9]{2,8}){1,2}\b")),
    (
        "address",
        re.compile(
            r"\b\d{2,6}\s+(?:[A-Z][A-Za-z]+\s+){1,3}"
            r"(?:Avenue|Ave|Street|St|Boulevard|Blvd|Road|Rd|Drive|Dr|Parkway|Pkwy|Lane|Ln|Way|Court|Ct|Place|Pl)\b\.?"
        ),
    ),
    ("number", re.compile(r"(?<![\w$])\d[\d,]*(?:\.\d+)?%?")),
]
CITATION_MARKER = re.compile(r"\[\d+(?:\s*,\s*\d+)*\]")
SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(\[])")


@dataclass
class Removal:
    sentence: str
    unsupported: list[str]


@dataclass
class EnforcementResult:
    text: str
    removed: list[Removal] = field(default_factory=list)
    checked_facts: int = 0


def normalize(text: str) -> str:
    text = text.casefold().replace("\\", "").replace("*", "")
    text = re.sub(r"(?<=\d),(?=\d{3}\b)", "", text)  # 396,000 == 396000
    text = re.sub(r"\$\s+", "$", text)
    text = re.sub(r"[‐-―]", "-", text)
    return re.sub(r"\s+", " ", text).strip()


def extract_facts(text: str) -> list[tuple[str, str]]:
    remaining = CITATION_MARKER.sub(" ", text)
    facts = []
    for kind, pattern in FACT_PATTERNS:
        for match in pattern.finditer(remaining):
            value = match.group(0).strip().rstrip(".,")
            if value:
                facts.append((kind, value))
        remaining = pattern.sub(lambda m: " " * len(m.group(0)), remaining)
    return facts


def split_sentences(text: str) -> list[str]:
    return [part for part in SENTENCE_BREAK.split(text) if part.strip()]


def enforce(text: str, evidence_texts: list[str]) -> EnforcementResult:
    """Drop every sentence with a fact not found verbatim in the cited evidence."""
    corpus = normalize(" ".join(evidence_texts))
    result = EnforcementResult(text="")
    kept_lines = []
    for line in text.splitlines():
        kept = []
        for sentence in split_sentences(line):
            facts = extract_facts(sentence)
            result.checked_facts += len(facts)
            missing = [value for _, value in facts if normalize(value) not in corpus]
            if missing:
                result.removed.append(Removal(sentence, missing))
                log.warning(
                    "citation enforcement removed a sentence; unsupported=%s sentence=%r", missing, sentence
                )
            else:
                kept.append(sentence)
        if kept or not line.strip():
            kept_lines.append(" ".join(kept))
    result.text = re.sub(r"\n{3,}", "\n\n", "\n".join(kept_lines)).strip()
    return result
