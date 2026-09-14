"""Offline checks for publishing real issues and Docket posts (no AWS, no database, no model)."""

import sys
import unittest
from datetime import UTC, date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from publish_issues import AgendaItem, Fact, issue_rows, verified_item  # noqa: E402
from publish_posts import MAX_BODY, agenda_post, comment_post, planned_posts  # noqa: E402

NEIGHBORHOODS = {"ardenwood": "Ardenwood", "niles": "Niles", "northgate": "Northgate"}
AGENDA = (
    "|  | C. | Second Reading and Adoption of an Ordinance Amending Fremont Municipal Code Section 2.05.060 "
    "(Compensation of Mayor And Council Members) to Adjust the Salaries of the Mayor And Council Members |\n"
    "|  | D. | Update of Conflict of Interest Code - Adopt a Resolution Updating the Conflict of Interest Code |"
)


class VerifiedItemTests(unittest.TestCase):
    def test_verbatim_title_supported_summary_and_facts_are_kept(self):
        item = AgendaItem(
            number="2C",
            section="Consent Calendar",
            title="Second Reading and Adoption of an Ordinance Amending Fremont Municipal Code Section 2.05.060",
            summary="The council would adopt an ordinance amending Section 2.05.060 to adjust council salaries.",
            topic="Budget",
            facts=[Fact(label="Code section", value="Section 2.05.060"), Fact(label="Cost", value="$50,000")],
        )
        row = verified_item(item, AGENDA, NEIGHBORHOODS)
        self.assertEqual(row["number"], "2C")
        self.assertEqual(row["section"], "consent calendar")
        self.assertEqual(row["facts"], [{"label": "Code section", "value": "Section 2.05.060"}])
        self.assertEqual(row["neighborhood_slugs"], [])

    def test_invented_title_or_unsupported_summary_is_rejected(self):
        invented = AgendaItem(
            number="2E", section="consent", title="Purchase of new fire engines", summary="x", topic="x"
        )
        self.assertIsNone(verified_item(invented, AGENDA, NEIGHBORHOODS))
        wrong_section = AgendaItem(
            number="2C",
            section="consent",
            title="Second Reading and Adoption of an Ordinance Amending Fremont Municipal Code",
            summary="It amends Section 2.05.070.",
            topic="Budget",
        )
        self.assertIsNone(verified_item(wrong_section, AGENDA, NEIGHBORHOODS))


class ItemRulesTests(unittest.TestCase):
    def test_bare_letters_and_procedural_items_are_not_issues(self):
        agenda = "|  | a. | Draft Resolution- ICE Free Zone |\n|  | A. | Waive Further Reading of Proposed Ordinances |"
        attachment = AgendaItem(
            number="A", section="other", title="Draft Resolution- ICE Free Zone", summary="x", topic="x"
        )
        procedural = AgendaItem(
            number="2A",
            section="consent calendar",
            title="Waive Further Reading of Proposed Ordinances",
            summary="x",
            topic="x",
        )
        self.assertIsNone(verified_item(attachment, agenda, NEIGHBORHOODS))
        self.assertIsNone(verified_item(procedural, agenda, NEIGHBORHOODS))

    def test_ids_use_the_meetings_fremont_date(self):
        doc = {
            "source_id": "fremont-council-iqm2",
            "title": "City Council Regular Meeting – Sep 15, 2026 7:00 PM",
            "url": "https://fremontcityca.iqm2.com/Citizens/Detail_Meeting.aspx?ID=2091",
            "published_at": datetime(2026, 9, 16, 2, 0, tzinfo=UTC),  # 7:00 PM Sep 15 in Fremont
        }
        item = {
            "number": "2C",
            "section": "consent calendar",
            "title": "Item title",
            "summary": "Summary.",
            "topic": "Budget",
            "facts": [],
            "neighborhood_slugs": [],
            "locator": "2. Consent Calendar",
        }
        row = issue_rows(doc, item, {})
        self.assertEqual((row["id"], row["ref"]), ("cc-2026-09-15-2c", "CC-26-0915-2C"))


class PostTests(unittest.TestCase):
    TOPIC = {
        "body": "city_council",
        "meeting_date": date(2026, 9, 8),
        "item_label": "Item 7A",
        "title": "Public Correspondence on Councilmember Keng's Referral (North Fremont Community Center, District 1)",
        "neighborhood_slugs": ["ardenwood", "northgate", "unknown-slug"],
        "comment_count": 30,
        "support_count": 30,
        "oppose_count": 0,
        "mixed_count": 0,
        "neutral_count": 0,
        "themes": [{"theme": "distance to existing centers", "count": 9}],
        "source_url": "https://fremontcityca.iqm2.com/Citizens/Detail_Meeting.aspx?ID=2090",
    }

    def test_comment_post_states_counts_and_stays_short(self):
        body = comment_post(self.TOPIC)
        self.assertIn("30 letters filed in the city's record, 30 support.", body)
        self.assertIn("Most mentioned: distance to existing centers.", body)
        self.assertLessEqual(len(body), MAX_BODY)

    def test_posts_go_to_named_neighborhoods_with_sources(self):
        issue = {
            "ref": "CC-26-0915-2C",
            "title": "Update of Conflict of Interest Code",
            "body": "City Council, consent calendar",
            "meeting_at": datetime(2026, 9, 16, 2, 0, tzinfo=UTC),
            "neighborhood_slugs": ["niles"],
            "source_url": "https://fremontcityca.iqm2.com/Citizens/Detail_Meeting.aspx?ID=2091",
            "citation": "City Council Regular Meeting – Sep 15, 2026 7:00 PM, 2. Consent Calendar",
            "summary": "The council would update the city's conflict of interest code.",
        }
        posts = planned_posts([self.TOPIC], [issue], NEIGHBORHOODS)
        targets = [post["neighborhood_slug"] for post in posts]
        self.assertEqual(targets, ["ardenwood", "northgate", None, "niles"])
        self.assertTrue(all(post["sources"] and post["sources"][0]["url"].startswith("https://") for post in posts))
        agenda = agenda_post({"body_name": "City Council", "meeting_at": issue["meeting_at"]}, [issue])
        self.assertTrue(agenda.startswith("City Council meets Sep 15 at 7:00 PM. On the agenda: 2C Update"))


if __name__ == "__main__":
    unittest.main()
