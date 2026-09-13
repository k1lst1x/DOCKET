"""Polite fetching: robots.txt, per-host rate limits and a descriptive User-Agent.

Requests identify as DOCKET by default. A source can opt out with send_user_agent=False
(Firecrawl only), for hosts whose bot firewalls reject that User-Agent. robots.txt is
still evaluated as DOCKET and crawl delays still apply. Firecrawl runs in basic proxy
mode only; stealth proxies are never used.
"""

import hashlib
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib import robotparser
from urllib.parse import urlsplit

import httpx
from firecrawl import Firecrawl
from firecrawl.v2.types import PDFParser

from core import settings

MIN_INTERVAL_S = 0.5  # at most 2 requests per second per host
ROBOTS_AGENT = settings.USER_AGENT.split("/", 1)[0]


@dataclass
class Artifact:
    url: str
    final_url: str
    status: int | None
    content_type: str | None
    raw: bytes  # original bytes when the fetcher returns them (HTML, PDF, zip, JSON)
    text: str | None  # Firecrawl markdown; None for plain HTTP
    fetcher: str
    content_hash: str
    fetched_at: datetime
    pages: list[tuple[int, str]] | None = None  # PDFs via Firecrawl: (physical page, markdown)


class RobotsDisallowed(Exception):
    pass


@dataclass
class RobotsRules:
    parser: robotparser.RobotFileParser | None  # None: no usable robots.txt, everything allowed
    disallow_all: bool = False

    def allowed(self, url: str) -> bool:
        if self.disallow_all:
            return False
        return True if self.parser is None else self.parser.can_fetch(ROBOTS_AGENT, url)

    def crawl_delay(self) -> float | None:
        if self.parser is None:
            return None
        delay = self.parser.crawl_delay(ROBOTS_AGENT)
        return float(delay) if delay is not None else None


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Fetcher:
    def __init__(self) -> None:
        self._http = httpx.Client(
            headers={"User-Agent": settings.USER_AGENT}, timeout=60.0, follow_redirects=True
        )
        self._firecrawl = (
            Firecrawl(api_key=settings.FIRECRAWL_API_KEY, timeout=120, max_retries=0)
            if settings.FIRECRAWL_API_KEY
            else None
        )
        self._last_request: dict[str, float] = {}
        self._robots: dict[tuple[str, str, bool], RobotsRules] = {}

    def check_robots(
        self, url: str, fetcher: str = "http", send_user_agent: bool = True
    ) -> tuple[bool, float | None]:
        rules = self._robots_for(url, fetcher, send_user_agent)
        return rules.allowed(url), rules.crawl_delay()

    def fetch(
        self,
        url: str,
        fetcher: str = "http",
        wait_for_ms: int | None = None,
        send_user_agent: bool = True,
        main_content: bool = False,
    ) -> Artifact:
        """main_content=True asks Firecrawl for main-content markdown (page chrome removed);
        rawHtml is always the full original page."""
        allowed, delay = self.check_robots(url, fetcher, send_user_agent)
        if not allowed:
            raise RobotsDisallowed(url)
        return self._get(url, fetcher, delay, wait_for_ms, send_user_agent, main_content)

    def _robots_for(self, url: str, fetcher: str, send_user_agent: bool) -> RobotsRules:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        key = (origin, fetcher, send_user_agent)
        if key in self._robots:
            return self._robots[key]
        artifact = None
        for attempt in range(3):  # one transient failure should not drop a whole source
            try:
                artifact = self._get(origin + "/robots.txt", fetcher, None, None, send_user_agent)
                break
            except Exception:
                if attempt < 2:
                    time.sleep(10)
        if artifact is None:
            # RFC 9309: an unreachable robots.txt means assume complete disallow.
            rules = RobotsRules(None, disallow_all=True)
        else:
            if artifact.status is not None and artifact.status >= 500:
                rules = RobotsRules(None, disallow_all=True)
            elif artifact.status is None or artifact.status >= 400:
                rules = RobotsRules(None)  # RFC 9309: unavailable (4xx) means no restrictions
            else:
                body = artifact.text if artifact.text is not None else artifact.raw.decode(
                    "utf-8", "replace"
                )
                parser = robotparser.RobotFileParser()
                parser.parse(body.replace("\\*", "*").replace("\\_", "_").splitlines())
                rules = RobotsRules(parser)
        self._robots[key] = rules
        return rules

    def _wait(self, url: str, crawl_delay: float | None) -> None:
        host = urlsplit(url).netloc
        interval = max(MIN_INTERVAL_S, crawl_delay or 0.0)
        last = self._last_request.get(host)
        if last is not None:
            remaining = interval - (time.monotonic() - last)
            if remaining > 0:
                time.sleep(remaining)
        self._last_request[host] = time.monotonic()

    def _get(
        self,
        url: str,
        fetcher: str,
        crawl_delay: float | None,
        wait_for_ms: int | None,
        send_user_agent: bool = True,
        main_content: bool = False,
    ) -> Artifact:
        self._wait(url, crawl_delay)
        fetched_at = datetime.now(UTC)
        if fetcher == "firecrawl":
            if self._firecrawl is None:
                raise RuntimeError("FIRECRAWL_API_KEY is not set")
            options = dict(
                formats=["markdown", "rawHtml"],
                only_main_content=main_content,
                proxy="basic",
                parsers=[PDFParser(pages=True)],  # applies to PDFs only: keeps physical pages
            )
            if send_user_agent:
                options["headers"] = {"User-Agent": settings.USER_AGENT}
            if wait_for_ms:
                options["wait_for"] = wait_for_ms
            document = self._firecrawl.scrape(url, **options)
            metadata = document.metadata
            text = document.markdown or ""
            pages = [(page.page_number, page.markdown) for page in (document.pages or [])]
            return Artifact(
                url=url,
                final_url=getattr(metadata, "url", None) or url,
                status=getattr(metadata, "status_code", None),
                content_type=getattr(metadata, "content_type", None),
                raw=(document.raw_html or "").encode("utf-8"),
                text=text,
                fetcher=fetcher,
                content_hash=_sha256(text.encode("utf-8")),
                fetched_at=fetched_at,
                pages=pages or None,
            )
        response = self._http.get(url)
        return Artifact(
            url=url,
            final_url=str(response.url),
            status=response.status_code,
            content_type=response.headers.get("content-type"),
            raw=response.content,
            text=None,
            fetcher="http",
            content_hash=_sha256(response.content),
            fetched_at=fetched_at,
        )
