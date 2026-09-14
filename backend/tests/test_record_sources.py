"""Offline checks for per-record, neighborhood-tagged sources (no network or AWS): neighborhood lookup,
the Fremont App API, Nixle alerts, GIS features, URL-keyed skipping and the ingest max_docs cap."""

import json
import sys
import unittest
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import arcgis_features, citysourced, neighborhoods, nixle  # noqa: E402
from core.discovery import DocumentRef, discover  # noqa: E402
from core.fetcher import Artifact  # noqa: E402
from core.jobs import MAX_INGEST_DOCS  # noqa: E402
from core.registry import Source, get_source, load_sources  # noqa: E402
from scripts import ingest  # noqa: E402


def square(x0: float, y0: float, x1: float, y1: float) -> list[list[float]]:
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]


def feature(name: str, geometry: dict) -> dict:
    return {"type": "Feature", "properties": {"NAME": name}, "geometry": geometry}


PIP_GEOJSON = {
    "type": "FeatureCollection",
    "features": [
        feature("Donut", {"type": "Polygon", "coordinates": [square(0, 0, 10, 10), square(4, 4, 6, 6)]}),
        feature("Islands", {"type": "MultiPolygon", "coordinates": [[square(20, 20, 30, 30)], [square(40, 40, 50, 50)]]}),
    ],
}
FREMONT_GEOJSON = {
    "type": "FeatureCollection",
    "features": [
        feature("Niles", {"type": "Polygon", "coordinates": [square(-122.00, 37.55, -121.95, 37.60)]}),
        feature(
            "Irvington",
            {
                "type": "MultiPolygon",
                "coordinates": [[square(-121.95, 37.50, -121.90, 37.55)], [square(-121.85, 37.45, -121.80, 37.50)]],
            },
        ),
        feature("Warm Springs", {"type": "Polygon", "coordinates": [square(-121.90, 37.40, -121.85, 37.45)]}),
    ],
}


def artifact(url: str, status: int, body: bytes | str) -> Artifact:
    raw = body.encode("utf-8") if isinstance(body, str) else body
    return Artifact(url, url, status, "text/html", raw, None, "http", "", datetime.now(UTC))


class FakeFetcher:
    def __init__(self, handler, post_handler=None):
        self.handler, self.post_handler = handler, post_handler
        self.gets: list[str] = []
        self.posts: list[tuple] = []

    def fetch(self, url, fetcher="http", wait_for_ms=None, send_user_agent=True, main_content=False):
        self.gets.append(url)
        return artifact(url, *self.handler(url))

    def post_form(self, url, data, headers=None):
        self.posts.append((url, data, headers))
        return artifact(url, *self.post_handler(url, data))


class NeighborhoodCase(unittest.TestCase):
    geojson = FREMONT_GEOJSON

    def setUp(self):
        neighborhoods.set_loader(lambda fetcher: self.geojson)

    def tearDown(self):
        neighborhoods.reset()


class PointInPolygonTests(NeighborhoodCase):
    geojson = PIP_GEOJSON

    def test_inside_outside_hole_and_multipolygon(self):
        self.assertEqual(neighborhoods.neighborhood_for(1, 1), "Donut")
        self.assertEqual(neighborhoods.neighborhood_for(9.5, 4.5), "Donut")
        self.assertIsNone(neighborhoods.neighborhood_for(5, 5))  # inside the hole
        self.assertIsNone(neighborhoods.neighborhood_for(15, 15))  # between shapes
        self.assertIsNone(neighborhoods.neighborhood_for(5, 11))  # lng outside the bounding box
        self.assertEqual(neighborhoods.neighborhood_for(25, 25), "Islands")
        self.assertEqual(neighborhoods.neighborhood_for(45, 45), "Islands")
        self.assertIsNone(neighborhoods.neighborhood_for(None, 1))

    def test_polygons_load_once_per_process(self):
        calls = []
        neighborhoods.set_loader(lambda fetcher: calls.append(1) or PIP_GEOJSON)
        for _ in range(3):
            neighborhoods.neighborhood_for(1, 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(neighborhoods.names(), ["Donut", "Islands"])

    def test_lookup_uses_lat_lng_order(self):
        neighborhoods.set_loader(lambda fetcher: FREMONT_GEOJSON)
        self.assertEqual(neighborhoods.neighborhood_for(37.575, -121.975), "Niles")
        self.assertIsNone(neighborhoods.neighborhood_for(-121.975, 37.575))


# --- Fremont App (CitySourced) -------------------------------------------------------------------

REPORTER_IDS = [
    "71181aee-fd42-f011-a81d-7c1e526db136",
    "a1b2c3d4-0000-4000-8000-00000000abcd",
    "deadbeef-1234-4321-8888-feedfacecafe",
]
PARENT_CASE_ID = "840a0ef3-61b0-f111-a8a7-000d3a0f8a39"
CITYSOURCED_RESPONSE = {
    "HasErrors": False,
    "ResultsCount": 3,
    "Results": [
        {
            "Id": "890A0EF3-61B0-F111-A8A7-000D3A0F8A39",
            "CaseNumber": "CAS-29532-C7H5J2",
            "CreatedOn": "9/14/2026 5:30:19 PM",
            "ModifiedOn": "9/14/2026 6:28:18 PM",
            "Description": "STAFF ENTRY, ES abatement (Fremont Blvd at Mowry)",
            "Line1": "39005 Fremont Blvd",
            "State": {"Id": "6809718d-ed85-ec11-a859-000d3a0f8a39", "Name": "CA"},
            "City": {"Id": "a369887e-9a8a-ea11-a83f-000d3a0f8010", "Name": "Fremont"},
            "ZipCode": "94538",
            "Latitude": "37.575",
            "Longitude": "-121.975",
            "ServiceActivityStatus": {"Id": "4269d295", "NameEN": "Closed", "NameES": "Cerrado"},
            "ServiceActivityStatusReason": {"Id": "758b3641", "NameEN": "Site Cleared", "NameES": "Site Cleared"},
            "ParentCaseId": PARENT_CASE_ID,
            "ReportedById": REPORTER_IDS[0],
            "HasImage": False,
            "Annotation": None,
            "RequestDetail": {"Id": "143b3fcb", "Name": "Encampment - Tent", "NameEN": "Encampment - Tent"},
        },
        {
            "Id": "11111111-2222-4333-8444-555555555555",
            "CaseNumber": "CAS-30001-AB12CD",
            "CreatedOn": "1/1/2026 8:00:00 AM",
            "ModifiedOn": None,
            "Description": "Pothole on\r\nWashington   Blvd",
            "Line1": "100 Washington Blvd",
            "City": "{'Id': 'c', 'Name': 'Fremont'}",
            "State": None,
            "ZipCode": "94539",
            "Latitude": "37.525",
            "Longitude": "-121.925",
            "ServiceActivityStatus": "{'Id': 'x', 'NameEN': 'In Progress', 'NameES': 'En progreso'}",
            "ServiceActivityStatusReason": "{'Id': 'y', 'NameEN': \"Referred to Public Works' crew\", 'NameES': 'Referido'}",
            "ParentCaseId": None,
            "ReportedById": REPORTER_IDS[1],
            "RequestDetail": None,
        },
        {
            "Id": "22222222-3333-4444-8555-666666666666",
            "CaseNumber": "CAS-30002-EF34GH",
            "CreatedOn": "9/10/2026 7:05:00 PM",
            "Description": "",
            "Line1": None,
            "Latitude": None,
            "Longitude": None,
            "ServiceActivityStatus": None,
            "ReportedById": REPORTER_IDS[2],
            "RequestDetail": "{'Id': 'z', 'Name': \"Driver's Complaint\", 'NameEN': \"Driver's Complaint\"}",
        },
    ],
}
NEARBY_PAGE = '<html><body><input type="hidden" id="hdnCsrfToken" name="hdnCsrfToken" value="tok123" /></body></html>'
NEARBY_URL = "https://fremontca.citysourced.com/servicerequests/nearby"


def citysourced_source() -> Source:
    return Source(
        "fremont-app-requests-api", "Fremont App", NEARBY_URL, "resident_issues", "api_query", "citysourced_api", True
    )


class CitySourcedTests(NeighborhoodCase):
    def expand(self, response=CITYSOURCED_RESPONSE):
        fetcher = FakeFetcher(
            lambda url: (200, NEARBY_PAGE), lambda url, data: (200, json.dumps(response))
        )
        return fetcher, citysourced.expand(fetcher, citysourced_source(), DocumentRef(NEARBY_URL, "x", "bulk_citysourced"))

    def test_discovery_needs_the_csrf_token(self):
        refs = discover(citysourced_source(), artifact(NEARBY_URL, 200, NEARBY_PAGE))
        self.assertEqual([(r.url, r.doc_type) for r in refs], [(NEARBY_URL, "bulk_citysourced")])
        self.assertEqual(discover(citysourced_source(), artifact(NEARBY_URL, 200, "<html></html>")), [])

    def test_expand_posts_the_nearby_query_with_a_fresh_token(self):
        fetcher, refs = self.expand()
        self.assertEqual(fetcher.gets, [NEARBY_URL])
        url, data, headers = fetcher.posts[0]
        self.assertEqual(url, citysourced.API_URL)
        self.assertEqual((data["token"], data["verb"], data["endpoint"]), ("tok123", "Post", "D365Proxy"))
        self.assertEqual(data["uniqueid"], "docket-civic-research")
        request = json.loads(data["json"])
        self.assertEqual((request["Path"], request["AuthType"], request["IsCustomAction"]), ("rst_oneviewcustomactions", 2, True))
        self.assertEqual(json.loads(request["Body"])["Endpoint"], "NEARBYREQUEST")
        self.assertEqual(headers["X-Requested-With"], "XMLHttpRequest")
        self.assertEqual(len(refs), 3)
        self.assertTrue(all(ref.doc_type == "service_request" and ref.locator == "service request" for ref in refs))

    def test_records_become_neighborhood_tagged_documents(self):
        _, refs = self.expand()
        first, second, third = refs
        self.assertEqual(first.url, "https://fremontca.citysourced.com/servicerequests/890a0ef3-61b0-f111-a8a7-000d3a0f8a39")
        self.assertEqual(first.title, "Fremont App request CAS-29532-C7H5J2: Encampment - Tent – Niles")
        self.assertEqual(first.published_at, datetime(2026, 9, 14, 10, 30, 19))  # 5:30 PM UTC is 10:30 AM PDT
        self.assertIn("- Reported: September 14, 2026, 10:30 AM (Fremont time)", first.inline_text)
        self.assertIn("- Last updated: September 14, 2026, 11:28 AM (Fremont time)", first.inline_text)
        self.assertRegex(first.inline_text, r"- Status as of \w+ \d{1,2}, \d{4}: Closed \(Site Cleared\)")
        self.assertIn("- Address: 39005 Fremont Blvd, Fremont, CA 94538", first.inline_text)
        self.assertIn("- Neighborhood: Niles\n- Coordinates: 37.57500, -121.97500", first.inline_text)
        self.assertIn("## Description\nSTAFF ENTRY, ES abatement (Fremont Blvd at Mowry)", first.inline_text)

        self.assertEqual(second.title, "Fremont App request CAS-30001-AB12CD: Service request – Irvington")
        self.assertEqual(second.published_at, datetime(2026, 1, 1, 0, 0))  # PST in winter
        self.assertIn("In Progress (Referred to Public Works' crew)", second.inline_text)
        self.assertIn("- Address: 100 Washington Blvd, Fremont 94539", second.inline_text)
        self.assertIn("Pothole on\nWashington Blvd", second.inline_text)

        self.assertEqual(third.title, "Fremont App request CAS-30002-EF34GH: Driver's Complaint")
        self.assertIn("- Neighborhood: unknown", third.inline_text)
        self.assertNotIn("Coordinates", third.inline_text)
        self.assertNotIn("Status as of", third.inline_text)

    def test_reporter_and_parent_ids_are_never_stored(self):
        _, refs = self.expand()
        for ref in refs:
            stored = f"{ref.url}\n{ref.title}\n{ref.inline_text}".lower()
            for private in [*REPORTER_IDS, PARENT_CASE_ID]:
                self.assertNotIn(private.lower(), stored)
            self.assertNotIn("reportedby", stored)

    def test_status_date_is_the_given_day(self):
        record = CITYSOURCED_RESPONSE["Results"][0]
        ref = citysourced.record_ref(record, date(2026, 9, 14))
        self.assertIn("- Status as of September 14, 2026: Closed (Site Cleared)", ref.inline_text)

    def test_lookup_names_from_objects_reprs_and_broken_reprs(self):
        self.assertEqual(citysourced.lookup_name({"NameEN": "Closed"}), "Closed")
        self.assertEqual(citysourced.lookup_name("{'Id': 'a', 'Name': 'Graffiti'}"), "Graffiti")
        self.assertEqual(citysourced.lookup_name('{"Id": "a", "NameEN": "O\'Brien Park"}'), "O'Brien Park")
        broken = "{'Id': 'a', 'NameEN': 'O'Brien Park', 'NameES': 'Parque O'Brien'"
        self.assertEqual(citysourced.lookup_name(broken), "O'Brien Park")
        self.assertEqual(citysourced.lookup_name(None), "")

    def test_api_errors_raise(self):
        with self.assertRaises(RuntimeError):
            self.expand({"HasErrors": True, "Errors": ["bad token"], "Results": []})


# --- Nixle ---------------------------------------------------------------------------------------

NIXLE_BASE = "https://local.nixle.com/fremont-police-department-ca/"
NIXLE_LISTING = """
<ol id="wire" class="clearfix">
    <li id="pub_12657925" class="first">
        <div class="wrapper"><div class="wire_priority">
            <span class="priority community">Community</span>
        </div><div class="wire_content">
        <h2 class="time">Entered: 5 days, 1 hour ago</h2>
        <p class="headline_agency">Press Release: Fatal Traffic Collision on August 25, 2026 <a href="https://nixle.us/HLSCT">More&nbsp;&raquo;</a> </p>
        </div></div>
    </li>
    <li id="pub_12653379">
        <div class="wrapper"><div class="wire_priority">
            <span class="priority advisory">Advisory</span>
        </div><div class="wire_content">
        <h2 class="time">Entered: 1 week ago</h2>
        <p class="headline_agency">Eastbound Stevenson Blvd from 880 to Farwell Dr is now open to traffic. <a href="https://nixle.us/HLMBB">More&nbsp;&raquo;</a> </p>
        </div></div>
    </li>
</ol>
<div class="pagination"><a href="?page=2" class="next">next &rsaquo;&rsaquo;</a></div>
"""
NIXLE_DETAIL = """<html><head>
<title>&ldquo;Press Release: Fatal Traffic Collision on August 25, 2026&rdquo; from Fremont Police Department (CA) : Nixle</title>
</head><body>
<div id="title"><div class="inner_structure"><h1><span style="font-size:0.6em;">Full Notification</span></h1></div></div>
<div class="hd clearfix" id="fullpubhd">
    <dl class="first"><dd class="certified"><a href="/fremont-police-department-ca/">Fremont Police Department (CA)</a></dd></dl>
    <dl class="last clearfix">
        <dd>Wednesday September 9th, 2026 :: 11:43 a.m. PDT</dd>
    </dl>
</div>
<div class="full_message_info">
    <div class="clearfix"></div>
    <span class="priority community">Community</span>
    <h2 style="float: left; width:475px;">Press Release: Fatal Traffic Collision on August 25, 2026</h2>
    <div class="clearfix"></div>
    <div id="alert-body">
        <p>On August 25, 2026, at approximately 1:30 p.m., officers responded to Paseo Padre Parkway near Niles.<br />
<br />
This is Fremont&rsquo;s 7<sup>th</sup> fatal traffic collision for 2026. Detour via Warm Springs Blvd.<br />
<strong>Media Contact:</strong> <a href="/cdn-cgi/l/email-protection#8cca"><span class="__cf_email__" data-cfemail="2d6b5f">[email&#160;protected]</span></a><br />
# # #</p>
    </div>
    <p class="agency first_agency"><strong>Address/Location</strong><br />2000 Stevenson Blvd</p>
</div>
</body></html>"""
NIXLE_DETAIL_WITHOUT_TIME = """<html><body>
<dl class="first"><dd class="certified"><a href="/fremont-police-department-ca/">Fremont Police Department (CA)</a></dd></dl>
<div class="full_message_info">
    <span class="priority advisory">Advisory</span>
    <h2 style="float: left;">Eastbound Stevenson Blvd from 880 to Farwell Dr is now open to traffic.</h2>
    <div id="alert-body"><p>All lanes are open.</p></div>
</div></body></html>"""


def nixle_source(**params) -> Source:
    return Source(
        "fremont-police-nixle", "Fremont Police Nixle", NIXLE_BASE, "public_safety", "listing_one_level",
        "nixle_agency", True, params=params,
    )


def nixle_pages(url: str) -> tuple[int, str]:
    return {
        NIXLE_BASE: (200, NIXLE_LISTING),
        "https://local.nixle.com/alert/12657925/": (200, NIXLE_DETAIL),
        "https://local.nixle.com/alert/12653379/": (200, NIXLE_DETAIL_WITHOUT_TIME),
    }.get(url, (404, "Not found"))


class NixleTests(NeighborhoodCase):
    def test_discovery_returns_one_bulk_ref(self):
        refs = discover(nixle_source(), artifact(NIXLE_BASE, 200, NIXLE_LISTING))
        self.assertEqual([(r.url, r.doc_type) for r in refs], [(NIXLE_BASE, "bulk_nixle")])
        self.assertEqual(discover(nixle_source(), artifact(NIXLE_BASE, 200, "<ol></ol>")), [])

    def test_listing_items(self):
        items = nixle.listing_items(NIXLE_LISTING)
        self.assertEqual([item.pub_id for item in items], ["12657925", "12653379"])
        self.assertEqual((items[0].priority, items[0].entered), ("Community", "Entered: 5 days, 1 hour ago"))
        self.assertEqual(items[0].headline, "Press Release: Fatal Traffic Collision on August 25, 2026")

    def test_expand_reads_pages_until_404_and_each_alert_page(self):
        fetcher = FakeFetcher(nixle_pages)
        refs = nixle.expand(fetcher, nixle_source(), DocumentRef(NIXLE_BASE, "x", "bulk_nixle"))
        self.assertEqual(fetcher.gets[:2], [NIXLE_BASE, NIXLE_BASE + "?page=2"])
        self.assertNotIn(NIXLE_BASE + "?page=3", fetcher.gets)
        self.assertEqual(len(refs), 2)
        release, advisory = refs
        self.assertEqual(release.url, "https://local.nixle.com/alert/12657925/")
        self.assertEqual((release.doc_type, release.locator), ("public_safety_alert", "alert"))
        self.assertEqual(release.title, "Press Release: Fatal Traffic Collision on August 25, 2026")
        self.assertEqual(release.published_at, datetime(2026, 9, 9, 11, 43))
        text = release.inline_text
        self.assertIn("- Agency: Fremont Police Department (CA)\n- Priority: Community", text)
        self.assertIn("- Posted: September 9, 2026, 11:43 AM (Fremont time)", text)
        self.assertIn("- Neighborhoods mentioned: Niles\n", text)  # "Warm Springs Blvd" is a street
        self.assertIn("## Full notification\nOn August 25, 2026", text)
        self.assertIn("Fremont’s 7th fatal traffic collision", text)
        self.assertIn("(email address on the Nixle page)", text)
        self.assertNotIn("cfemail", text)
        self.assertNotIn("Address/Location", text)

        now = datetime.now(ZoneInfo("America/Los_Angeles")).replace(tzinfo=None)
        self.assertLess(abs(advisory.published_at - (now - timedelta(weeks=1))), timedelta(minutes=5))
        self.assertIn("(approximate, from the listing's relative time)", advisory.inline_text)
        self.assertIn("- Priority: Advisory", advisory.inline_text)

    def test_max_pages_limits_listing_requests(self):
        fetcher = FakeFetcher(nixle_pages)
        nixle.expand(fetcher, nixle_source(max_pages=1), DocumentRef(NIXLE_BASE, "x", "bulk_nixle"))
        self.assertNotIn(NIXLE_BASE + "?page=2", fetcher.gets)

    def test_posted_and_relative_times(self):
        self.assertEqual(nixle.parse_posted("Monday March 2nd, 2026 :: 7:05 p.m. PST"), datetime(2026, 3, 2, 19, 5))
        self.assertEqual(nixle.parse_posted("Friday May 1st, 2026 :: 12:10 a.m. PDT"), datetime(2026, 5, 1, 0, 10))
        now = datetime(2026, 9, 14, 12, 0)
        self.assertEqual(nixle.parse_entered("Entered: 2 days, 23 hours ago", now), datetime(2026, 9, 11, 13, 0))
        self.assertIsNone(nixle.parse_entered("Entered: just now", now))


# --- ArcGIS features -----------------------------------------------------------------------------

LAYER = "https://services2.arcgis.com/example/arcgis/rest/services/Development_Activity/FeatureServer/119"
FORBIDDEN = ["Jane Owner", "applicant@example.com", "Planner Pat", "1 Applicant Way", "Owner_NM", "Apl_Cont", "Plnr_Cont"]
DEV_PARAMS = {
    "layer": LAYER,
    "title": "{Prj_Name}",
    "title_fallback": "Development project {Prj_Num}",
    "fields": {"Prj_Name": "Project", "Prj_Num": "Project number", "Status": "Status", "SFU_New": "New single-family units"},
}
DEV_PAGES = {
    0: {
        "objectIdFieldName": "OBJECTID",
        "exceededTransferLimit": True,
        "features": [
            {
                "attributes": {
                    "OBJECTID": 7, "Prj_Name": "Mowry Village", "Prj_Num": "PLN2026-00012", "Status": "Approved",
                    "SFU_New": 12.0, "Owner_NM": "Jane Owner", "Apl_Cont": "applicant@example.com",
                    "Plnr_Cont": "Planner Pat", "Apl_Addr_Fu": "1 Applicant Way",
                },
                # The large ring is in Niles; a small detached ring sits in Irvington.
                "geometry": {"rings": [square(-121.99, 37.56, -121.96, 37.59), square(-121.93, 37.52, -121.929, 37.521)]},
            }
        ],
    },
    1: {
        "exceededTransferLimit": False,
        "features": [
            {
                "attributes": {"OBJECTID": 9, "Prj_Name": " ", "Prj_Num": "PLN2026-00020", "Status": None, "SFU_New": 0},
                "geometry": {"x": -121.925, "y": 37.525},
            }
        ],
    },
}


def gis_source(params: dict, source_id: str = "dev-test") -> Source:
    return Source(source_id, "Development activity sites", f"{LAYER}?f=json", "development", "api_query", "arcgis_features", True, params=params)


def arcgis_handler(pages: dict[int, dict]):
    def handler(url: str) -> tuple[int, str]:
        offset = int(parse_qs(urlsplit(url).query)["resultOffset"][0])
        return (200, json.dumps(pages[offset])) if offset in pages else (400, "{}")

    return handler


class ArcgisFeatureTests(NeighborhoodCase):
    def test_metadata_discovery_checks_configured_fields(self):
        metadata = {"objectIdField": "OBJECTID", "fields": [{"name": name} for name in ["OBJECTID", *DEV_PARAMS["fields"]]]}
        refs = discover(gis_source(DEV_PARAMS), artifact(f"{LAYER}?f=json", 200, json.dumps(metadata)))
        self.assertEqual([(r.url, r.doc_type) for r in refs], [(LAYER, "bulk_arcgis")])
        metadata["fields"] = [{"name": "OBJECTID"}, {"name": "Prj_Name"}]
        with self.assertRaises(ValueError):
            discover(gis_source(DEV_PARAMS), artifact(f"{LAYER}?f=json", 200, json.dumps(metadata)))

    def test_pages_until_the_transfer_limit_clears_and_stores_only_allowlisted_fields(self):
        fetcher = FakeFetcher(arcgis_handler(DEV_PAGES))
        refs = arcgis_features.expand(fetcher, gis_source(DEV_PARAMS), DocumentRef(LAYER, "x", "bulk_arcgis"))
        queries = [parse_qs(urlsplit(url).query) for url in fetcher.gets]
        self.assertEqual([q["resultOffset"][0] for q in queries], ["0", "1"])
        self.assertEqual(queries[0]["outFields"][0], "OBJECTID,Prj_Name,Prj_Num,Status,SFU_New")
        self.assertEqual((queries[0]["outSR"][0], queries[0]["returnGeometry"][0]), ("4326", "true"))

        self.assertEqual(len(refs), 2)
        by_title = {ref.title: ref for ref in refs}
        village = by_title["Mowry Village – Niles"]
        self.assertEqual(village.url, f"{LAYER}/query?where=OBJECTID%3D7&outFields=*&f=html")
        self.assertEqual((village.doc_type, village.locator, village.published_at), ("gis_feature", "record", None))
        self.assertIn("- Project number: PLN2026-00012\n- Status: Approved\n- New single-family units: 12\n", village.inline_text)
        self.assertIn("- Neighborhood: Niles\n- Map location (approximate): 37.57500, -121.97500", village.inline_text)
        fallback = by_title["Development project PLN2026-00020 – Irvington"]
        self.assertIn("- New single-family units: 0", fallback.inline_text)
        for ref in refs:
            for private in FORBIDDEN:
                self.assertNotIn(private, f"{ref.title}\n{ref.url}\n{ref.inline_text}")

    def test_group_by_combines_features_per_group_and_neighborhood(self):
        params = {
            "layer": LAYER,
            "title": "{CIP_Prj_Name}",
            "group_by": ["CIP_Prj_Name"],
            "fields": {"CIP_Prj_Name": "Program", "Road_Name": "Road", "CIP_Prj_Description": "Description"},
        }
        program = {"CIP_Prj_Name": "2026 Pavement Program", "CIP_Prj_Description": "Resurfacing of city streets."}
        pages = {
            0: {
                "features": [
                    {"attributes": {"OBJECTID": 1, **program, "Road_Name": "Mowry Ave"}, "geometry": {"x": -121.97, "y": 37.57}},
                    {"attributes": {"OBJECTID": 2, **program, "Road_Name": "Blacow Rd"}, "geometry": {"x": -121.96, "y": 37.58}},
                    {"attributes": {"OBJECTID": 4, **program, "Road_Name": "Mowry Ave"}, "geometry": {"x": -121.98, "y": 37.56}},
                    {"attributes": {"OBJECTID": 3, **program, "Road_Name": "Osgood Rd"}, "geometry": {"x": -121.92, "y": 37.52}},
                ]
            }
        }
        refs = arcgis_features.expand(FakeFetcher(arcgis_handler(pages)), gis_source(params, "annual"), DocumentRef(LAYER, "x", "bulk_arcgis"))
        self.assertEqual([ref.title for ref in refs], ["2026 Pavement Program – Irvington", "2026 Pavement Program – Niles"])
        irvington, niles = refs
        self.assertTrue(niles.url.startswith(f"{LAYER}/query?where=CIP_Prj_Name%3D%272026%20Pavement%20Program%27"))
        self.assertTrue(niles.url.endswith("&outFields=*&f=html#niles"))
        self.assertTrue(irvington.url.endswith("#irvington"))
        self.assertIn("- Mapped locations: 3", niles.inline_text)
        self.assertEqual(niles.inline_text.count("Resurfacing of city streets."), 1)
        self.assertLess(niles.inline_text.index("## Blacow Rd"), niles.inline_text.index("## Mowry Ave"))
        self.assertEqual(niles.inline_text.count("## Mowry Ave"), 1)  # identical locations are listed once
        self.assertIn("- Map locations (approximate): 37.56000, -121.98000; 37.57000, -121.97000", niles.inline_text)
        self.assertIn("- Mapped locations: 1\n\n## Osgood Rd\n- Road: Osgood Rd", irvington.inline_text)

    def test_title_fields_must_be_allowlisted(self):
        with self.assertRaises(ValueError):
            arcgis_features.configured_fields({"title": "{Owner_NM}", "fields": {"Prj_Name": "Project"}})

    def test_representative_points(self):
        self.assertEqual(arcgis_features.representative_point({"x": -121.9, "y": 37.5}), (37.5, -121.9))
        lat, lng = arcgis_features.representative_point({"rings": [square(0, 0, 4, 2), square(10, 10, 11, 11)]})
        self.assertAlmostEqual(lat, 1.0)
        self.assertAlmostEqual(lng, 2.0)
        line = {"paths": [[[0, 0], [1, 0]], [[0, 5], [1, 5], [2, 5], [3, 5], [9, 5]]]}
        self.assertEqual(arcgis_features.representative_point(line), (5.0, 2.0))
        self.assertIsNone(arcgis_features.representative_point(None))


# --- Ingest: selection, URL-keyed skipping, dispatch and the max_docs cap ---------------------------


class IngestSelectionTests(unittest.TestCase):
    def ref(self, url: str, doc_type: str, days_ago: int | None, inline: str | None = "text") -> DocumentRef:
        when = datetime.now() - timedelta(days=days_ago) if days_ago is not None else None
        return DocumentRef(url, url, doc_type, when, inline_text=inline)

    def test_inline_record_types_skip_known_urls(self):
        for doc_type in ("service_request", "public_safety_alert", "gis_feature"):
            with patch.object(ingest, "has_url", return_value=True) as has_url:
                outcome = ingest.ingest_ref(None, None, None, None, citysourced_source(), self.ref("https://x/1", doc_type, 1))
            self.assertEqual(outcome, "skipped_known_url", doc_type)
            has_url.assert_called_once_with(None, "https://x/1")

    def test_other_inline_types_keep_hash_only_dedupe(self):
        with patch.object(ingest, "has_url", MagicMock(return_value=True)) as has_url, patch.object(
            ingest, "has_hash", return_value=True
        ):
            outcome = ingest.ingest_ref(None, None, None, None, citysourced_source(), self.ref("https://x/2", "bill_version", 1))
        self.assertEqual(outcome, "skipped_same_hash")
        has_url.assert_not_called()
        self.assertTrue(ingest.skips_known_url(self.ref("https://x/3", "news", 1, inline=None)))
        self.assertFalse(ingest.skips_known_url(self.ref("https://x/4", "news", 1)))

    def test_reselection_keeps_bill_versions_outside_the_lookback(self):
        refs = [
            self.ref("old-bill", "bill_version", 300),
            self.ref("new-bill", "bill_version", 2),
            self.ref("old-request", "service_request", 300),
            self.ref("new-request", "service_request", 1),
            self.ref("feature", "gis_feature", None),
        ]
        selected = ingest.select_refs(refs, 120, 10, ingest.LOOKBACK_EXEMPT_TYPES)
        self.assertEqual([r.url for r in selected], ["new-request", "new-bill", "old-bill", "feature"])
        self.assertEqual([r.url for r in ingest.select_refs(refs, 120, 2, ingest.LOOKBACK_EXEMPT_TYPES)], ["new-request", "new-bill"])
        self.assertNotIn("old-bill", [r.url for r in ingest.select_refs(refs, 120, 10)])

    def test_expand_bulk_dispatches_by_doc_type(self):
        expanded = [self.ref("https://x/alert", "public_safety_alert", 1)]
        fake = MagicMock(return_value=expanded)
        page = self.ref("https://x/page", "page", None, inline=None)
        bulk = self.ref("https://x/listing", "bulk_nixle", None, inline=None)
        with patch.dict(ingest.EXPANDERS, {"bulk_nixle": fake}):
            result = ingest.expand_bulk(None, nixle_source(), [page, bulk])
        self.assertEqual(result, [page, *expanded])
        fake.assert_called_once()
        self.assertEqual(set(ingest.EXPANDERS), {"bulk_pubinfo", "bulk_citysourced", "bulk_nixle", "bulk_arcgis"})


class MaxDocsCapTests(unittest.TestCase):
    def test_api_accepts_up_to_2000(self):
        from pydantic import ValidationError

        from api.main import IngestRequest

        self.assertEqual(MAX_INGEST_DOCS, 2000)
        self.assertEqual(IngestRequest(max_docs=2000).max_docs, 2000)
        with self.assertRaises(ValidationError):
            IngestRequest(max_docs=2001)

    def test_pipeline_clamps_to_2000(self):
        import agentcore_pipeline

        with patch.object(agentcore_pipeline.threading, "Thread"), patch.object(
            agentcore_pipeline.app, "add_async_task", return_value=1
        ):
            high = agentcore_pipeline.invoke({"action": "ingest", "max_docs": 5000}, None)
            low = agentcore_pipeline.invoke({"action": "ingest", "max_docs": 0}, None)
        self.assertEqual(agentcore_pipeline.JOBS[high["job_id"]]["max_docs"], 2000)
        self.assertEqual(agentcore_pipeline.JOBS[low["job_id"]]["max_docs"], 1)


class RegistryTests(unittest.TestCase):
    def test_new_sources_are_configured(self):
        enabled = {source.id: source for source in load_sources()}
        self.assertFalse(get_source("fremont-app-requests").enabled)
        expected = {
            "fremont-app-requests-api": "citysourced_api",
            "fremont-police-nixle": "nixle_agency",
            "city-of-fremont-nixle": "nixle_agency",
            "fremont-capital-projects-gis": "arcgis_features",
            "fremont-annual-street-programs-gis": "arcgis_features",
            "fremont-development-activity-gis": "arcgis_features",
            "fremont-transportation-projects-gis": "arcgis_features",
        }
        for source_id, parser in expected.items():
            source = enabled[source_id]
            self.assertEqual((source.parser, source.fetcher), (parser, "http"), source_id)
        for source in enabled.values():
            if source.parser != "arcgis_features":
                continue
            self.assertTrue(source.url.startswith(source.params["layer"] + "?"), source.id)
            arcgis_features.configured_fields(source.params)
            for private in ("Owner_NM", "Apl_Cont", "Apl_Addr_Fu", "Plnr_Cont"):
                self.assertNotIn(private, source.params["fields"], source.id)


if __name__ == "__main__":
    unittest.main()
