"""Source registry loaded from config/sources.yaml."""

from dataclasses import dataclass, field
from pathlib import Path

import yaml

from core import settings

REQUIRED_FIELDS = ("id", "name", "url", "kind", "crawl_strategy", "parser", "enabled")


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    url: str
    kind: str
    crawl_strategy: str
    parser: str
    enabled: bool
    fetcher: str = "http"
    send_user_agent: bool = True
    schedule: str = "weekly"
    verify_pattern: str | None = None
    params: dict = field(default_factory=dict)


def load_sources(path: Path = settings.SOURCES_FILE, enabled_only: bool = True) -> list[Source]:
    entries = yaml.safe_load(path.read_text(encoding="utf-8"))["sources"]
    sources = []
    for entry in entries:
        missing = [name for name in REQUIRED_FIELDS if name not in entry]
        if missing:
            raise ValueError(f"source {entry.get('id')!r} is missing {missing}")
        if entry.get("fetcher", "http") not in ("http", "firecrawl"):
            raise ValueError(f"source {entry['id']!r} has unknown fetcher {entry['fetcher']!r}")
        sources.append(Source(**entry))
    ids = [source.id for source in sources]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate source ids in registry")
    return [source for source in sources if source.enabled or not enabled_only]


def get_source(source_id: str) -> Source:
    for source in load_sources(enabled_only=False):
        if source.id == source_id:
            return source
    raise KeyError(source_id)
