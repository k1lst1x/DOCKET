"""Bulk refs stand for many documents; each bulk doc_type has an expander that returns them."""

from collections.abc import Callable

from core import arcgis_features, citysourced, legislature, nixle
from core.discovery import DocumentRef
from core.fetcher import Fetcher
from core.registry import Source

EXPANDERS: dict[str, Callable[[Fetcher, Source, DocumentRef], list[DocumentRef]]] = {
    "bulk_pubinfo": legislature.expand,
    "bulk_citysourced": citysourced.expand,
    "bulk_nixle": nixle.expand,
    "bulk_arcgis": arcgis_features.expand,
}
