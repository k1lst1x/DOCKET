"""Offline checks for how chat answers are finalized (no AWS, no database)."""

import unittest
from unittest.mock import patch

from core import chat_agent
from core.chat_agent import STORED_CHUNK_ID, TurnEvidence, build_tools, finalize, searched_summary
from core.retrieval import Evidence


def source(source_id: str, name: str, kind: str) -> dict:
    return {"source_id": source_id, "name": name, "kind": kind, "document_count": 1}


SOURCES = [
    source("fremont-council-iqm2", "City of Fremont meeting portal", "meetings"),
    source("fremont-agenda-center-council", "Agenda Center", "meetings"),
    source("fremont-news", "City of Fremont news", "news"),
    source("ca-assembly-members", "California State Assembly", "reference"),
]

NOTICE = Evidence(
    chunk_id="0b6a4f2e-7c1d-4e8a-9b3f-5d2c1a0e9f87",
    document_id="d-news",
    source_id="fremont-news",
    source_name="City of Fremont news",
    title="City Offices Closed in Observance of Labor Day",
    url="https://www.fremont.gov/Home/Components/News/News/1/1067",
    locator="document start",
    doc_type="news",
    published_at="2026-09-04T21:31:00+00:00",
    text=(
        "Post Date:09/04/2026 2:31 PMCity of Fremont offices will be closed Monday, September 7 in "
        "observance of Labor Day."
    ),
)


def turn_with(*items: Evidence) -> TurnEvidence:
    turn = TurnEvidence()
    turn.add(list(items))
    turn.retrieval_calls = 1
    return turn


class FinalizeTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(chat_agent, "_searched_sources", return_value=SOURCES)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_refusal_names_the_kinds_of_sources_in_one_sentence(self):
        question = "What is the median household income in Fremont?"
        response = finalize(question, "I don't have anything in my sources about that.", TurnEvidence())
        self.assertTrue(response.refused)
        self.assertEqual(
            response.answer,
            "I don't have anything in my sources about that. I searched City Council agendas and minutes, "
            "city news and state legislator listings.",
        )
        self.assertEqual(len(response.sources_searched), 4)

    def test_date_with_narrow_spaces_and_a_year_from_the_post_date_is_kept(self):
        raw = (
            "City of Fremont offices were closed Monday, September 7, 2026 in observance of "
            "Labor Day【1†L1-L2】."
        )
        question = "When were City of Fremont offices closed for Labor Day in 2026?"
        response = finalize(question, raw, turn_with(NOTICE))
        self.assertFalse(response.refused, response.removed_sentences)
        self.assertEqual(
            response.answer,
            "City of Fremont offices were closed Monday, September 7, 2026 in observance of Labor Day[1].",
        )

    def test_wrong_day_is_still_removed(self):
        answer = "Offices closed Tuesday, September 8, 2026 [1]."
        response = finalize("When was the Labor Day closure in Fremont?", answer, turn_with(NOTICE))
        self.assertTrue(response.refused)

    def test_summary_lists_one_phrase_per_kind(self):
        self.assertEqual(searched_summary(SOURCES[2:3]), "city news")
        self.assertEqual(searched_summary([]), "")


class AddressLookupTests(unittest.TestCase):
    def test_neighborhood_lookup_is_citable_and_not_saved_as_a_stored_chunk(self):
        turn = TurnEvidence()
        located = {"matched_address": "3300 CAPITOL AVE, FREMONT, CA, 94538", "lat": 37.55, "lng": -121.98}
        with (
            patch.object(chat_agent, "geocode", return_value=located),
            patch.object(chat_agent, "neighborhood_at", return_value="Central"),
            patch.object(chat_agent.retrieval, "keyword_search", return_value=[]),
            patch.object(chat_agent, "_searched_sources", return_value=SOURCES),
        ):
            tools = {tool.tool_name: tool for tool in build_tools(turn)}
            evidence = tools["search_by_address"](address="3300 Capitol Avenue")
            turn.retrieval_calls = 1
            answer = "3300 Capitol Avenue is in the Central neighborhood [1]."
            response = finalize("Which neighborhood is 3300 Capitol Avenue in?", answer, turn)
        self.assertIn("[1] Neighborhood lookup for 3300 CAPITOL AVE", evidence)
        self.assertFalse(response.refused, response.removed_sentences)
        self.assertTrue(response.citations[0].url.endswith("/Neighborhoods/FeatureServer/0"))
        self.assertIsNone(STORED_CHUNK_ID.match(response.cited_chunk_ids[0]))
        self.assertIsNotNone(STORED_CHUNK_ID.match(NOTICE.chunk_id))


if __name__ == "__main__":
    unittest.main()
