"""Semantic chunking of extracted markdown.

Boundaries come first from structure: markdown headings, bold agenda items ("**2. Consent
Calendar**", then sub-items such as "**D. Delegation of Authority**" or "**4.1 ...**"), code
section numbers ("Section 18.190.030") and bold lead-in titles ("**Key Components of a Safe
System** Implementation of..."). Sections are then packed into chunks of about 700 tokens
with 100 tokens of overlap.

Every chunk carries a locator: for PDFs the physical page plus the heading path ("p. 3 ›
2. Consent Calendar › D. Delegation of Authority"), for HTML the heading path alone. The
document title is stored on the document row, so it is left out of locators.
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass

TARGET_TOKENS = 700
OVERLAP_TOKENS = 100
CHARS_PER_TOKEN = 4  # packing estimate only; stored token_count comes from the embedding model
LABEL_CHARS = 80
BOLD_LINE_LEVEL = 6  # bold lead-in title, e.g. "**Key Components of a Safe System**"
ITEM_LEVEL = 7  # "2. Consent Calendar": below every markdown heading level
SUBITEM_LEVEL = 8  # "D. ...", "4.1 ...", "Section 18.190.030"

HEADING = re.compile(r"^(#{1,6})\s+(.+)$")
BOLD_ITEM = re.compile(r"^\|?\s*\*\*\s*\d{1,2}\.\s*(?:\*\*\s*\|?\s*\*\*)?\s*[A-Za-z]")
BOLD_SUBITEM = re.compile(r"^\|?\s*\*\*\s*(?:\d{1,2}(?:\.\d+)+\.?|[A-Z]\.)\s*(?:\*\*\s*\|?\s*\*\*)?\s*\S")
SECTION_NUMBER = re.compile(r"^\s*\**\s*(?:Section|Sec\.|§)\s*\d+(?:[.-]\d+)+", re.IGNORECASE)
BOLD_LEAD = re.compile(r"^\*\*([^*]{3,120})\*\*")
SKIP_LINK = re.compile(r"^\[Skip to [^\]]*\]\([^)]*\)$", re.IGNORECASE)


@dataclass
class Chunk:
    ordinal: int
    text: str
    locator: str
    est_tokens: int


def _clean(line: str) -> str:
    line = re.sub(r"</?strong>", "", line)
    line = re.sub(r"\[Skip to [^\]]*\]\([^)]*\)", "", line, flags=re.IGNORECASE)  # page chrome
    line = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", line)  # images carry no text
    line = re.sub(r"\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)", r"\1", line)  # keep link text, drop URL
    line = re.sub(r"\\([.\-_*#()\[\]|])", r"\1", line)
    return re.sub(r"\\(?=\s|$)", "", line)


def _label(text: str) -> str:
    text = re.sub(r"[*|#\\]", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" :–-")
    if len(text) > LABEL_CHARS:
        cut = text.rfind(" ", 0, LABEL_CHARS)
        text = text[: cut if cut > LABEL_CHARS // 2 else LABEL_CHARS].rstrip(" ,;:–-") + "…"
    return text


def _item_label(stripped: str) -> str:
    """Use the bold title alone when it has words; otherwise ("**4.** | **Title**") the whole line."""
    lead = BOLD_LEAD.match(stripped.lstrip("| "))
    if lead and len(re.sub(r"[\d.A-Z\s]", "", lead.group(1))) >= 3:
        return _label(lead.group(1))
    return _label(stripped)


def _boundary(line: str) -> tuple[int, str] | None:
    heading = HEADING.match(line)
    if heading:
        return len(heading.group(1)), _label(heading.group(2))
    stripped = line.strip()
    if BOLD_ITEM.match(stripped):
        return ITEM_LEVEL, _item_label(stripped)
    if BOLD_SUBITEM.match(stripped) or SECTION_NUMBER.match(stripped):
        return SUBITEM_LEVEL, _item_label(stripped)
    lead = BOLD_LEAD.match(stripped)
    if lead and _label(lead.group(1)):
        return BOLD_LINE_LEVEL, _label(lead.group(1))
    return None


def _sections(pages: Iterable[tuple[int | None, str]]) -> list[tuple[str, str]]:
    stack: list[tuple[int, str]] = []
    sections: list[tuple[str, str]] = []
    lines: list[str] = []
    page: int | None = None

    def flush() -> None:
        text = "\n".join(lines).strip()
        if text:
            path = " › ".join(label for level, label in stack if level > 1)
            parts = [part for part in (f"p. {page}" if page else "", path) if part]
            sections.append((" › ".join(parts) or "document start", text))
        lines.clear()

    for page_number, markdown in pages:
        flush()  # text read so far belongs to the previous page
        page = page_number
        for raw in markdown.splitlines():
            line = _clean(raw)
            if SKIP_LINK.match(line.strip()):
                continue
            boundary = _boundary(line)
            if boundary:
                flush()
                level, label = boundary
                while stack and stack[-1][0] >= level:
                    stack.pop()
                stack.append((level, label))
            lines.append(line)
    flush()
    return sections


def _split_long(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    units = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(units) == 1:
        units = re.split(r"(?<=[.!?])\s+", text)
    parts: list[str] = []
    current = ""
    for unit in units:
        while len(unit) > max_chars:  # no natural break left: cut at a space
            cut = unit.rfind(" ", 0, max_chars)
            cut = cut if cut > max_chars // 2 else max_chars
            parts.append(unit[:cut])
            unit = unit[cut:].lstrip()
        if current and len(current) + len(unit) + 2 > max_chars:
            parts.append(current)
            current = unit
        else:
            current = f"{current}\n\n{unit}" if current else unit
    if current:
        parts.append(current)
    return parts


def _tail(text: str, chars: int) -> str:
    if len(text) <= chars:
        return text
    start = text.find(" ", len(text) - chars)
    return text[start + 1 :] if start != -1 else text[-chars:]


def _pack(sections: list[tuple[str, str]]) -> list[Chunk]:
    max_chars = TARGET_TOKENS * CHARS_PER_TOKEN
    overlap_chars = OVERLAP_TOKENS * CHARS_PER_TOKEN
    pieces = [(locator, part) for locator, text in sections for part in _split_long(text, max_chars)]
    chunks: list[Chunk] = []
    text, locator, fresh = "", "document start", False

    def emit() -> None:
        body = text.strip()
        if body and fresh:
            chunks.append(Chunk(len(chunks), body, locator, max(1, len(body) // CHARS_PER_TOKEN)))

    for piece_locator, piece in pieces:
        if fresh and len(text) + len(piece) + 2 > max_chars:
            emit()
            text, fresh = _tail(text, overlap_chars), False
        if not fresh:
            locator = piece_locator  # a chunk is located where its own new content starts
        text = f"{text}\n\n{piece}" if text else piece
        fresh = True
    emit()
    return chunks


def chunk_markdown(markdown: str) -> list[Chunk]:
    """Chunk an HTML page (or any text without physical pages)."""
    return _pack(_sections([(None, markdown)]))


def chunk_pages(pages: list[tuple[int, str]]) -> list[Chunk]:
    """Chunk a PDF from (physical page number, page markdown) pairs; locators start with the page."""
    return _pack(_sections(sorted(pages)))
