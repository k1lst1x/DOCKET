"""Offline checks for the ArcGIS FeatureServer parser and scheduled source selection (no network or AWS)."""

import json
import sys
import unittest
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.discovery import discover  # noqa: E402
from core.fetcher import Artifact  # noqa: E402
from core.registry import Source, load_sources  # noqa: E402
from scripts.ingest import inline_chunks, select_sources  # noqa: E402

LAYER = "https://services2.arcgis.com/example/arcgis/rest/services/Neighborhoods/FeatureServer/0/query?f=json"


def source(**params) -> Source:
    return Source(
        id="gis-test",
        name="Test neighborhoods layer",
        url=LAYER,
        kind="reference",
        crawl_strategy="api_query",
        parser="arcgis_featureserver",
        enabled=True,
        params=params,
    )


def artifact(payload: dict) -> Artifact:
    raw = json.dumps(payload).encode("utf-8")
    return Artifact(LAYER, LAYER, 200, "application/json", raw, None, "http", "hash", datetime.now(UTC))


NEIGHBORHOODS = {
    "features": [
        {"attributes": {"NAME": "Niles", "REGION": "07", "HISTORIC": "Y", "Acres": 1523.456}},
        {"attributes": {"NAME": "Ardenwood", "REGION": "02", "HISTORIC": " ", "Acres": 1188.80692258905}},
    ]
}
NEIGHBORHOOD_PARAMS = {"title": "{NAME}", "fields": {"REGION": "Region", "HISTORIC": "Historic", "Acres": "Area (acres)"}}


class ArcgisParserTests(unittest.TestCase):
    def test_layer_becomes_one_inline_document_with_a_heading_per_feature(self):
        refs = discover(source(**NEIGHBORHOOD_PARAMS), artifact(NEIGHBORHOODS))
        self.assertEqual(len(refs), 1)
        ref = refs[0]
        self.assertEqual((ref.url, ref.doc_type, ref.locator), (LAYER, "gis_layer", "layer"))
        self.assertTrue(ref.inline_text.startswith("## Layer summary\n2 records in the City of Fremont ArcGIS layer"))
        self.assertLess(ref.inline_text.index("## Ardenwood"), ref.inline_text.index("## Niles"))
        self.assertIn("- Area (acres): 1,188.8", ref.inline_text)
        self.assertIn("- Historic: Y", ref.inline_text)
        ardenwood = ref.inline_text.split("## Ardenwood")[1].split("## Niles")[0]
        self.assertNotIn("Historic", ardenwood)  # blank attributes are left out, not printed empty

    def test_chunk_locators_name_the_feature(self):
        ref = discover(source(**NEIGHBORHOOD_PARAMS), artifact(NEIGHBORHOODS))[0]
        locators = " ".join(chunk.locator for chunk in inline_chunks(ref, ref.inline_text))
        # Small sections merge into one chunk, located by the span of headings it covers.
        self.assertEqual(locators, "layer › Layer summary … Niles")

    def test_statistics_rows_use_the_fallback_title_when_a_title_field_is_blank(self):
        params = {
            "title": "{ZONE_DIST} (class {ZN_CLASS})",
            "title_fallback": "Class {ZN_CLASS} areas with no zoning district code",
            "fields": {"parcels": "Mapped areas", "acres": "Total acres"},
        }
        payload = {
            "features": [
                {"attributes": {"ZONE_DIST": "C-G", "ZN_CLASS": "C", "parcels": 37, "acres": 196.128}},
                {"attributes": {"ZONE_DIST": " ", "ZN_CLASS": "R", "parcels": 416, "acres": 4508.162}},
            ]
        }
        text = discover(source(**params), artifact(payload))[0].inline_text
        self.assertIn("## C-G (class C)\n- Mapped areas: 37\n- Total acres: 196.1", text)
        self.assertIn("## Class R areas with no zoning district code\n- Mapped areas: 416", text)

    def test_same_payload_gives_identical_text(self):
        first = discover(source(**NEIGHBORHOOD_PARAMS), artifact(NEIGHBORHOODS))[0].inline_text
        reordered = {"features": list(reversed(NEIGHBORHOODS["features"]))}
        self.assertEqual(first, discover(source(**NEIGHBORHOOD_PARAMS), artifact(reordered))[0].inline_text)

    def test_truncated_and_failed_queries_raise(self):
        with self.assertRaises(ValueError):
            discover(source(**NEIGHBORHOOD_PARAMS), artifact({**NEIGHBORHOODS, "exceededTransferLimit": True}))
        with self.assertRaises(ValueError):
            discover(source(**NEIGHBORHOOD_PARAMS), artifact({"error": {"code": 400, "message": "Invalid query"}}))

    def test_no_features_means_no_documents(self):
        self.assertEqual(discover(source(**NEIGHBORHOOD_PARAMS), artifact({"features": []})), [])

    def test_registry_arcgis_sources_are_configured(self):
        gis = [s for s in load_sources() if s.parser == "arcgis_featureserver"]
        self.assertGreaterEqual(len(gis), 2)
        for entry in gis:
            self.assertIn("returnGeometry=false", entry.url, entry.id)
            self.assertTrue(entry.params.get("title") and entry.params.get("fields"), entry.id)


class ScheduleSelectionTests(unittest.TestCase):
    def test_schedule_and_ids_filter_sources(self):
        sources = load_sources()
        daily = select_sources(sources, [], "daily")
        self.assertTrue(daily)
        self.assertTrue(all(s.schedule == "daily" for s in daily))
        weekly_ids = {s.id for s in select_sources(sources, [], "weekly")}
        self.assertIn("fremont-council-iqm2", weekly_ids)
        self.assertNotIn("fremont-news", weekly_ids)
        self.assertEqual(select_sources(sources, [], None), sources)
        self.assertEqual([s.id for s in select_sources(sources, ["fremont-news"], "weekly")], [])

    def test_every_enabled_source_is_on_a_known_schedule(self):
        for entry in load_sources():
            self.assertIn(entry.schedule, ("daily", "weekly", "monthly"), entry.id)


if __name__ == "__main__":
    unittest.main()
