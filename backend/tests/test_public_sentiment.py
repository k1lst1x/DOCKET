"""Offline checks for what the public-sentiment step stores (no AWS, no database, no model)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from public_sentiment import FiledComment, checked, redact_contacts, slugs_named, topic_for  # noqa: E402

NEIGHBORHOODS = {"ardenwood": "Ardenwood", "northgate": "Northgate", "niles": "Niles"}

LETTER = (
    "From: Example Resident\nTo: councilmeetings\nSubject: Item 7A - Community Center\n"
    "Date: Saturday, September 5, 2026 6:42:00 AM\nDear Members of the City Council,\n"
    "I am a resident of Ardenwood area. I fully support building a community center and a satellite\n"
    "library for the north Fremont area. Call me at (510) 555-0123 or write to 1234 Sample Ter."
)


class TopicTests(unittest.TestCase):
    def test_council_item_and_za_application_titles(self):
        council = topic_for(
            "d1",
            "City Council Sep 8, 2026 – Item 7A1 Public Correspondence on Councilmember Keng's Referral",
            "https://fremontcityca.iqm2.com/Citizens/Detail_Meeting.aspx?ID=2090",
        )
        self.assertEqual(council["id"], "cc-2026-09-08-item-7a")
        self.assertEqual((council["body"], council["item_label"]), ("city_council", "Item 7A"))
        za = topic_for(
            "d2",
            "Zoning Administrator Aug 18, 2026 – Public Correspondence on PLN2026-00162 (FCSN, 3800 Beard Road)",
            "https://city.fremont.gov/zoningadministrator",
        )
        self.assertEqual(za["id"], "za-2026-08-18-pln2026-00162")
        self.assertIsNone(topic_for("d3", "AB 306: research note", "https://example.invalid"))


class CheckedCommentTests(unittest.TestCase):
    def test_verbatim_excerpt_verified_date_and_area_are_kept(self):
        comment = FiledComment(
            stance="support",
            sent_date="2026-09-05",
            author_area="Ardenwood",
            excerpt="I fully support building a community center and a satellite library for the north Fremont area.",
            themes=["North Fremont lacks a center", "Library"],
        )
        row = checked(comment, LETTER, NEIGHBORHOODS)
        self.assertEqual(row["stance"], "support")
        self.assertEqual(row["sent_at"], "2026-09-05")
        self.assertEqual(row["author_area"], "Ardenwood")
        self.assertEqual(row["themes"], ["north fremont lacks a center", "library"])

    def test_paraphrase_is_rejected(self):
        comment = FiledComment(stance="support", excerpt="The writer really wants a community center.")
        self.assertIsNone(checked(comment, LETTER, NEIGHBORHOODS))

    def test_unverified_date_and_non_place_area_are_dropped(self):
        comment = FiledComment(
            stance="support",
            sent_date="2026-09-06",
            author_area="Example Resident",
            excerpt="I fully support building a community center",
        )
        row = checked(comment, LETTER, NEIGHBORHOODS)
        self.assertIsNone(row["sent_at"])
        self.assertIsNone(row["author_area"])

    def test_contacts_in_excerpts_are_redacted(self):
        comment = FiledComment(stance="neutral", excerpt="Call me at (510) 555-0123 or write to 1234 Sample Ter.")
        row = checked(comment, LETTER, NEIGHBORHOODS)
        self.assertNotIn("555-0123", row["excerpt"])
        self.assertNotIn("Sample Ter", row["excerpt"])
        self.assertEqual(redact_contacts("mail pat@example.com"), "mail [redacted]")

    def test_neighborhoods_named_in_letters(self):
        self.assertEqual(slugs_named([LETTER, "Northgate community member"], NEIGHBORHOODS), ["ardenwood", "northgate"])


if __name__ == "__main__":
    unittest.main()
