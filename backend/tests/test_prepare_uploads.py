"""Offline checks for preparing team-supplied files (redaction and metadata; no AWS)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from prepare_uploads import redact, research_note  # noqa: E402


class RedactionTests(unittest.TestCase):
    def test_private_emails_and_home_addresses_are_redacted(self):
        # Made-up residents and addresses in the formats the real letters use.
        text = (
            "From: Pat Example <pat.example@example.com>\n"
            "1234 Sample Ter., Fremont CA 94555\n"
            "45678, Placeholder Terrace, Fremont, CA-94555\n"
            "23456 Invented Rd, Fremont, CA\n"
            "My neighbors at 1001, 1003, 1005 Fictional Terrace"
        )
        cleaned, count = redact(text)
        for private in ("pat.example", "Sample Ter", "Placeholder", "Invented", "1003"):
            self.assertNotIn(private, cleaned)
        self.assertGreaterEqual(count, 5)

    def test_city_contacts_and_public_sites_stay(self):
        text = (
            "Teresa Keng | TKeng@fremont.gov\n3300 Capitol Ave., Bldg. A, Fremont, CA 94538\n"
            "Adult Day Program at 3800 Beard Road\n39550 Liberty Street"
        )
        cleaned, count = redact(text)
        self.assertEqual(cleaned, text)
        self.assertEqual(count, 0)


class ResearchNoteTests(unittest.TestCase):
    def test_title_and_link_come_from_the_note(self):
        page = (
            "AB 306: California Building Standards Commission:\nappeals: code interpretations\n"
            "California State Legislation and Its Direct Connection to Fremont, California\n"
            "5. Sources\nCalifornia / bill source: https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?"
            "bill_id=202520260AB306\n"
        )
        upload = research_note(Path("01_AB_306_Fremont.pdf"), [(1, page)])
        self.assertTrue(upload.title.startswith("AB 306: California Building Standards Commission: appeals"))
        self.assertTrue(upload.url.endswith("bill_id=202520260AB306"))
        self.assertEqual(upload.source_id, "docket-bill-research-notes")


if __name__ == "__main__":
    unittest.main()
