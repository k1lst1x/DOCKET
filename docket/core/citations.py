"""Citation enforcement in code: every fact in generated text must appear in the cited evidence.

Extracts dollar amounts, dates, code section references, record ids (case, permit and request
numbers), street addresses and bare numbers from generated text. A sentence containing any fact
that does not appear in at least one cited chunk is removed, and the removal is logged.

Matching is verbatim after light normalization only: case, whitespace, markdown emphasis and
thousands separators. Dates are the one exception: a date matches when the cited text contains the
same calendar date in any common format, so "September 8, 2026" matches "9/8/2026" but "9/9/2026"
and "September 9, 2026" do not.
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime

log = logging.getLogger("docket.citations")

MONTH = (
    r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|"
    r"Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?"
)
DATE_PATTERN = re.compile(
    rf"\b{MONTH}\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+\d{{4}}\b|\b\d{{1,2}}/\d{{1,2}}/\d{{2,4}}\b"
    rf"|\b\d{{4}}-\d{{2}}-\d{{2}}\b|\b{MONTH}\s+\d{{4}}\b"
)

# Order matters: specific kinds are matched and masked before bare numbers.
FACT_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("dollar", re.compile(r"\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand))?", re.IGNORECASE)),
    ("date", DATE_PATTERN),
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
# No break before "[": a citation marker belongs to the sentence before it ("... Inc. [1]."), so it
# can never survive alone after its sentence is removed.
SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(])")
DATE_FORMATS = (
    ("%B %d %Y", "%Y-%m-%d"),
    ("%b %d %Y", "%Y-%m-%d"),
    ("%m/%d/%Y", "%Y-%m-%d"),
    ("%m/%d/%y", "%Y-%m-%d"),
    ("%Y-%m-%d", "%Y-%m-%d"),
    ("%B %Y", "%Y-%m"),
    ("%b %Y", "%Y-%m"),
)


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


def canonical_date(value: str) -> str | None:
    """"September 8, 2026", "Sep. 8th 2026", "9/8/2026" and "2026-09-08" all become "2026-09-08"."""
    cleaned = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", value)
    cleaned = re.sub(r"\bSept\b", "Sep", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", re.sub(r"[.,]", " ", cleaned)).strip()
    for parse_format, canonical_format in DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, parse_format).strftime(canonical_format)
        except ValueError:
            continue
    return None


def dates_in(text: str) -> set[str]:
    found = set()
    for match in DATE_PATTERN.finditer(text):
        canonical = canonical_date(match.group(0))
        if canonical:
            found.add(canonical)
            found.add(canonical[:7])  # a day also supports its month ("September 2026")
    return found


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


def _supported(kind: str, value: str, corpus: str, corpus_dates: set[str]) -> bool:
    if normalize(value) in corpus:
        return True
    if kind == "date":
        canonical = canonical_date(value)
        return canonical is not None and canonical in corpus_dates
    return False


def enforce(text: str, evidence_texts: list[str]) -> EnforcementResult:
    """Drop every sentence with a fact not found in the cited evidence."""
    joined = " ".join(evidence_texts)
    corpus = normalize(joined)
    corpus_dates = dates_in(joined)
    result = EnforcementResult(text="")
    kept_lines = []
    for line in text.splitlines():
        kept = []
        for sentence in split_sentences(line):
            facts = extract_facts(sentence)
            result.checked_facts += len(facts)
            missing = [value for kind, value in facts if not _supported(kind, value, corpus, corpus_dates)]
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
