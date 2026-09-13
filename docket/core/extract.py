"""Text extraction and content hashing for fetched artifacts.

Firecrawl already returns markdown (main content for HTML, per-page text for PDFs). Plain
HTTP HTML goes through trafilatura. The content hash ignores relative timestamps such as
"Updated: 1w ago", so an unchanged page hashes the same on every crawl.
"""

import hashlib
import re

import trafilatura

from core.fetcher import Artifact

RELATIVE_TIME = re.compile(
    r"\b(?:Updated:\s*)?\d+\s*(?:s|m|h|d|w|mo|y|sec|min|hour|day|week|month|year)s?\s+ago\b",
    re.IGNORECASE,
)


def document_text(artifact: Artifact) -> str:
    if artifact.text is not None:
        return artifact.text
    content_type = (artifact.content_type or "").lower()
    body = artifact.raw.decode("utf-8", "replace")
    if "html" in content_type:
        return (
            trafilatura.extract(
                body,
                url=artifact.final_url,
                output_format="markdown",
                include_tables=True,
                include_links=False,
                include_formatting=True,
                favor_recall=True,
            )
            or ""
        )
    return body


def content_hash(text: str) -> str:
    normalized = re.sub(r"\s+", " ", RELATIVE_TIME.sub("", text)).strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
