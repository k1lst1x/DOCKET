"""Offline checks for the chat agent's live lookups (no AWS, no database, no network)."""

import unittest
from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx

from core import chat_agent, live_tools
from core.chat_agent import TurnEvidence, build_tools, finalize
from core.live_tools import (
    FREMONT_TZ,
    LiveUnavailable,
    Neighborhood,
    Bounds,
    fremont_time,
    issue_text,
    pacific_time,
    parse_chp,
    parse_closures,
    parse_feed,
    parse_nws_alerts,
    parse_usgs,
    place_text,
    vote_text,
)

NOW = datetime(2026, 9, 14, 17, 0, tzinfo=UTC)
IRVINGTON = Neighborhood("irvington", "Irvington", Bounds(37.535, 37.515, -121.955, -121.985))


def chp_log(log_id: str, latlon: str, log_type: str = "1182-Trfc Collision-No Inj") -> str:
    return (
        f'<Log ID="{log_id}"><LogTime>"Sep 14 2026  9:05AM"</LogTime><LogType>"{log_type}"</LogType>'
        f'<Location>"I880 N / Mission Blvd"</Location><Area>"Hayward"</Area><LATLON>"{latlon}"</LATLON></Log>'
    )


class FormattingTests(unittest.TestCase):
    def test_fremont_time_uses_pacific_time_and_a_citable_date(self):
        self.assertEqual(fremont_time(NOW), "September 14, 2026 at 10:00 AM")

    def test_pacific_time_parses_the_chp_log_format(self):
        self.assertEqual(pacific_time("Sep 14 2026  9:05AM"), datetime(2026, 9, 14, 9, 5, tzinfo=FREMONT_TZ))
        self.assertIsNone(pacific_time("tomorrow"))

    def test_vote_text_counts_names_and_numbers(self):
        self.assertEqual(
            vote_text({"ayes": ["Mei", "Salwan"], "noes": 1, "absent": []}), "Vote: 2 ayes (Mei, Salwan), 1 noes."
        )
        self.assertEqual(vote_text(None), "")

    def test_issue_text_labels_neighbor_votes_as_opinions(self):
        row = {
            "ref": "PLN2026-00188",
            "title": "2057 Olive Avenue townhomes",
            "status": "watching",
            "topic": "Housing",
            "meeting_at": datetime(2026, 9, 24, 19, 0, tzinfo=FREMONT_TZ),
            "deadline": None,
            "neighborhood_slugs": [],
            "summary": "Planning Commission hearing on 14 townhomes.",
            "pros": [{"text": "Adds housing", "basis": "source"}],
            "cons": [{"text": "More traffic", "basis": "inference"}],
            "source_url": "https://fremontcityca.iqm2.com/x",
            "body": "",
        }
        with patch.object(live_tools, "neighborhoods", return_value=[]):
            text = issue_text(row, {"support": 12, "oppose": 3}, (4, 3.5), [], [])
        self.assertIn("Meeting: September 24, 2026 at 7:00 PM.", text)
        self.assertIn("residents' opinions, not an official vote): 12 support, 3 oppose.", text)
        self.assertIn("Neighbor reviews on Docket: 4, average rating 3.5 out of 5.", text)
        self.assertIn("- More traffic (Docket's inference)", text)


class FeedParserTests(unittest.TestCase):
    def test_chp_keeps_only_incidents_near_fremont(self):
        xml = chp_log("1", "37550000:121980000") + chp_log("2", "34050000:118240000")  # Fremont, Los Angeles
        incidents = parse_chp(xml)
        self.assertEqual([i.id for i in incidents], ["chp-1"])
        self.assertEqual(incidents[0].title, "Collision, no injuries")
        self.assertEqual(incidents[0].started, datetime(2026, 9, 14, 9, 5, tzinfo=FREMONT_TZ))

    def test_usgs_drops_small_distant_quakes(self):
        def quake(qid, mag, lng, lat):
            return {"id": qid, "properties": {"mag": mag, "place": "near", "time": 1789000000000}, "geometry": {"coordinates": [lng, lat, 5]}}

        data = {"features": [quake("near", 1.2, -121.97, 37.53), quake("far-small", 2.0, -121.0, 37.0), quake("far-big", 3.4, -121.0, 37.0)]}
        self.assertEqual([i.id for i in parse_usgs(data)], ["quake-near", "quake-far-big"])

    def test_closures_need_a_crew_on_scene_and_an_open_window(self):
        def record(index, in_place=True, end_epoch="4102444800"):
            return {
                "lcs": {
                    "index": index,
                    "location": {"travelFlowDirection": "North", "begin": {"beginLatitude": "37.53", "beginLongitude": "-121.97", "beginRoute": "I-880", "beginLocationName": "Mowry Ave"}},
                    "closure": {
                        "closureTimestamp": {"closureStartEpoch": "1789000000", "closureEndEpoch": end_epoch},
                        "typeOfClosure": "Lane",
                        "lanesClosed": "1",
                        "totalExistingLanes": "4",
                        "code1097": {"isCode1097": "true" if in_place else "false"},
                    },
                }
            }

        data = {"data": [record("open"), record("not-started", in_place=False), record("finished", end_epoch="1789000100")]}
        closures = parse_closures(data, NOW)
        self.assertEqual([c.id for c in closures], ["closure-open"])
        self.assertIn("1 of 4 lanes closed", closures[0].detail)

    def test_nws_skips_expired_and_test_alerts(self):
        def alert(aid, status="Actual", ends="2026-09-15T08:00:00-07:00"):
            return {"properties": {"id": aid, "event": "Heat Advisory", "severity": "Moderate", "status": status, "ends": ends}}

        data = {"features": [alert("live"), alert("test", status="Test"), alert("old", ends="2026-09-13T08:00:00-07:00")]}
        self.assertEqual([a.id for a in parse_nws_alerts(data, NOW)], ["live"])

    def test_parse_feed_strips_the_google_news_publisher_suffix(self):
        xml = (
            "<rss><channel><item><title>Fremont council approves budget - East Bay Times</title>"
            "<link>https://news.example/a</link><pubDate>Sun, 13 Sep 2026 18:00:00 GMT</pubDate>"
            "<source url='https://eastbaytimes.com'>East Bay Times</source>"
            "<description>&lt;a href=x&gt;Fremont council approves budget&lt;/a&gt;</description></item></channel></rss>"
        )
        [story] = parse_feed(xml)
        self.assertEqual(story.title, "Fremont council approves budget")
        self.assertEqual(story.source, "East Bay Times")
        self.assertEqual(story.snippet, "")
        self.assertEqual(story.published, datetime(2026, 9, 13, 18, 0, tzinfo=UTC))


class LookupTests(unittest.TestCase):
    def setUp(self):
        live_tools.clear_cache()
        self.addCleanup(live_tools.clear_cache)

    def test_live_incidents_reports_counts_and_narrows_local_kinds_to_the_neighborhood(self):
        inside = live_tools.Incident("chp-in", "traffic", "Traffic hazard", "", "moderate", 37.525, -121.97, None, None, "CHP", "u")
        outside = live_tools.Incident("chp-out", "traffic", "Traffic hazard", "", "minor", 37.60, -122.05, None, None, "CHP", "u")
        feeds = [live_tools.Feed("traffic", "CHP live incidents", 60, lambda now: [inside, outside])]
        with patch.object(live_tools, "FEEDS", feeds), patch.object(live_tools, "resolve_neighborhood", return_value=IRVINGTON):
            items = live_tools.live_incidents("crash", "Irvington", now=NOW)
        self.assertIn("CHP traffic incidents: 1.", items[0].text)
        self.assertEqual([item.document_id for item in items[1:]], ["lookup:traffic:chp-in"])
        self.assertTrue(items[1].chunk_id.startswith("lookup:"))

    def test_live_incidents_is_unavailable_when_every_feed_fails(self):
        def broken(now):
            raise httpx.ConnectError("down")

        with patch.object(live_tools, "FEEDS", [live_tools.Feed("quake", "USGS earthquakes", 60, broken)]):
            with self.assertRaises(LiveUnavailable):
                live_tools.live_incidents(now=NOW)

    def test_unknown_neighborhood_names_the_real_ones(self):
        with patch.object(live_tools, "neighborhoods", return_value=[IRVINGTON]):
            self.assertEqual(live_tools.resolve_neighborhood("irvington"), IRVINGTON)
            self.assertIsNone(live_tools.resolve_neighborhood("All of Fremont"))
            with self.assertRaisesRegex(LiveUnavailable, "Irvington"):
                live_tools.resolve_neighborhood("Atlantis")

    def test_posts_with_unreviewed_media_are_hidden(self):
        created = datetime(2026, 9, 14, 9, 0, tzinfo=UTC)
        rows = [
            ("p1", "Farmers market is back", created, "irvington", None, None, None, "Ana", 3, 1),
            ("p2", "Look at this", created, "irvington", None, None, [{"key": "uploads/a/1.jpg"}], "Bo", 0, 0),
        ]

        def db(sql, params=()):
            return rows if "FROM posts p" in sql else [("uploads/a/1.jpg", "pending")]

        with patch.object(live_tools, "_db", side_effect=db), patch.object(live_tools, "neighborhoods", return_value=[IRVINGTON]):
            items = live_tools.neighborhood_posts("", "")
        self.assertEqual(len(items), 1)
        self.assertIn('Ana posted to Irvington', items[0].text)
        self.assertIn("not verified by Docket", items[0].text)

    def test_find_places_without_a_key_is_unavailable(self):
        with patch.object(live_tools.settings, "google_places_api_key", return_value=""):
            with self.assertRaises(LiveUnavailable):
                live_tools.find_places("boba")

    def test_find_places_formats_google_details(self):
        response = MagicMock()
        response.json.return_value = {
            "places": [
                {
                    "id": "abc",
                    "displayName": {"text": "Tea Time"},
                    "formattedAddress": "123 Fremont Blvd, Fremont, CA 94538",
                    "rating": 4.6,
                    "userRatingCount": 1234,
                    "currentOpeningHours": {"openNow": True},
                    "googleMapsUri": "https://maps.google.com/?cid=1",
                }
            ]
        }
        with (
            patch.object(live_tools.settings, "google_places_api_key", return_value="key"),
            patch.object(live_tools, "resolve_neighborhood", return_value=None),
            patch.object(live_tools.httpx, "post", return_value=response) as post,
        ):
            [item] = live_tools.find_places("boba", open_now=True)
        self.assertEqual(post.call_args.kwargs["json"]["openNow"], True)
        self.assertEqual(item.source_name, "Google Maps")
        self.assertIn("Rated 4.6 out of 5 from 1,234 Google reviews. Open now.", item.text)
        self.assertEqual(place_text({"displayName": {"text": "X"}}), "X.")

    def test_web_search_reads_only_pages_robots_txt_allows(self):
        client = MagicMock()
        client.search.return_value = SimpleNamespace(
            web=[
                SimpleNamespace(url="https://allowed.example/a", title="Allowed", description="snippet a"),
                SimpleNamespace(url="https://blocked.example/b", title="Blocked", description="snippet b"),
                SimpleNamespace(url="https://www.facebook.com/c", title="Login", description="snippet c"),
            ]
        )
        client.scrape.return_value = SimpleNamespace(markdown="Full [page](https://x) text")
        with (
            patch.object(live_tools, "_firecrawl", return_value=client),
            patch.object(live_tools, "robots_allows", side_effect=lambda url: "allowed" in url),
        ):
            items = live_tools.web_search("fremont farmers market hours")
        self.assertEqual([item.text for item in items], ["Full page text", "snippet b", "snippet c"])
        self.assertEqual([item.locator for item in items], ["Web page", "Search result summary", "Search result summary"])
        client.scrape.assert_called_once()

    def test_robots_rules(self):
        def fake_get(status, body=""):
            return MagicMock(status_code=status, text=body)

        cases = [
            (fake_get(404), True),
            (fake_get(503), False),
            (fake_get(200, "User-agent: *\nDisallow: /private"), False),
        ]
        for response, expected in cases:
            live_tools.clear_cache()
            with patch.object(live_tools.httpx, "get", return_value=response):
                self.assertEqual(live_tools.robots_allows("https://site.example/private/page"), expected)


class ChatWiringTests(unittest.TestCase):
    def test_every_live_tool_counts_as_retrieval(self):
        names = {getattr(t, "tool_name", getattr(t, "__name__", "")) for t in build_tools(TurnEvidence())}
        for name in ("docket_issues", "meeting_decisions", "neighborhood_posts", "live_incidents", "local_news", "find_places", "web_search"):
            self.assertIn(name, names)
            self.assertIn(name, chat_agent.RETRIEVAL_TOOLS)

    def test_unavailable_source_is_reported_not_raised(self):
        turn = TurnEvidence()
        tools = {getattr(t, "tool_name", ""): t for t in build_tools(turn)}
        with patch.object(live_tools, "find_places", side_effect=LiveUnavailable("Place lookups aren't set up yet.")):
            reply = tools["find_places"](query="tacos")
        self.assertEqual(reply, "Not available: Place lookups aren't set up yet.")
        self.assertEqual(turn.searched_live, ["Google Maps places"])

    def test_refusal_names_live_sources_searched(self):
        turn = TurnEvidence()
        turn.retrieval_calls = 1
        turn.searched_live = ["local news", "the web"]
        with patch.object(chat_agent, "_searched_sources", return_value=[]):
            response = finalize("anything new at Lake Elizabeth?", "Nothing found.", turn)
        self.assertTrue(response.refused)
        self.assertIn("I searched local news and the web.", response.answer)

    def test_a_cited_vote_count_survives_enforcement(self):
        item = live_tools.evidence(
            "issue",
            "pln2026-00188",
            source="Docket issues",
            title="PLN2026-00188: Olive Avenue townhomes",
            url="https://docket.example/g/irvington?issue=pln2026-00188",
            locator="Docket's tracked issues, votes and reviews",
            text="Neighbors' stance votes on Docket (residents' opinions, not an official vote): 12 support, 3 oppose.",
            when=datetime(2026, 9, 24, 19, 0, tzinfo=FREMONT_TZ),
        )
        turn = TurnEvidence()
        turn.add([item])
        turn.retrieval_calls = 1
        with patch.object(chat_agent, "_searched_sources", return_value=[]):
            response = finalize(
                "How do neighbors feel about the Olive Avenue townhomes in Fremont?",
                "On Docket, 12 neighbors support it and 3 oppose it; these are residents' opinions, not an official vote [1].",
                turn,
            )
        self.assertFalse(response.refused)
        self.assertEqual(response.citations[0].url, "https://docket.example/g/irvington?issue=pln2026-00188")
        self.assertEqual(response.citations[0].date, date(2026, 9, 24).isoformat())

    def test_system_prompt_carries_todays_fremont_date(self):
        self.assertIn("Today in Fremont is Monday, September 14, 2026.", chat_agent.system_prompt(NOW))


if __name__ == "__main__":
    unittest.main()
