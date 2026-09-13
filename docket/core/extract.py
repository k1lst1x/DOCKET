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


# Simbli meeting pages render a picker listing every meeting ("- 03/26/2025 - 5:00 PM - Regular
# Meeting of the Board of Education"). It grows with each new meeting, so it is page chrome.
MEETING_PICKER_LINE = re.compile(
    r"^(?:-\s+\d{2}/\d{2}/\d{4}\s+-\s+\d{1,2}:\d{2}\s+[AP]M\s+-\s+.*|.*--Select Meeting--.*)$", re.MULTILINE
)


# Google Translate's widget sometimes renders these lines and sometimes does not, which would
# change the content hash of an otherwise identical page.
TRANSLATE_WIDGET_LINE = re.compile(
    r"^\s*(?:Original text|Rate this translation|"
    r"Your feedback will be used to help improve Google Translate)\s*$",
    re.MULTILINE,
)
# Widgets fremont.gov renders only on some loads: a dismiss button and embedded YouTube players.
DISMISS_BUTTON_LINE = re.compile(r"^\s*Close\s*\**\s*×\s*\**\s*$", re.MULTILINE)
YOUTUBE_EMBED = re.compile(r"^[^\n]* - YouTube\s*$.*?^\s*Watch on\s*$", re.MULTILINE | re.DOTALL)


IQM2_NAV_END = "Print This Page"
IQM2_FOOTER = "**Shortcut Keys:**"


def document_text(artifact: Artifact) -> str:
    if artifact.text is not None:
        text = TRANSLATE_WIDGET_LINE.sub("", artifact.text)
        text = YOUTUBE_EMBED.sub("", DISMISS_BUTTON_LINE.sub("", text))
        if "«Back to Main Site" in text and IQM2_NAV_END in text:
            # IQM2 meeting page: drop the portal navigation above the meeting header and the
            # keyboard-shortcut help and language list below the agenda.
            text = text[text.index(IQM2_NAV_END) + len(IQM2_NAV_END) :]
            footer = text.find(IQM2_FOOTER)
            if footer != -1:
                text = text[:footer]
        if MEETING_PICKER_LINE.search(text):
            # Simbli meeting page: drop the picker and the navigation above the meeting title (H1).
            text = MEETING_PICKER_LINE.sub("", text)
            title = re.search(r"^# ", text, re.MULTILINE)
            if title:
                text = text[title.start() :]
        return text
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
    """Hash of the readable text. URLs are left out, so rotating link tokens (Zoom passwords, calendar
    links, image CDNs) and relative timestamps do not make an unchanged page look new."""
    text = RELATIVE_TIME.sub("", text)
    text = re.sub(r"!\[[^\]]*\]\((?:[^()]|\([^)]*\))*\)", "", text)  # images
    text = re.sub(r"\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)", r"\1", text)  # links keep their text
    text = re.sub(r"<[^>\n]*>|https?://\S+", " ", text)  # placeholders and bare URLs
    normalized = re.sub(r"\s+", " ", text).strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
