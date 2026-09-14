"""Offline checks for the RSS feed parser (made-up feed; no network)."""

import unittest
from datetime import UTC, datetime

from core.discovery import _rss_feed
from core.fetcher import Artifact
from core.registry import Source

FEED = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Example News</title>
<item>
  <title>Crosswalk upgrade planned near Fremont school</title>
  <link>https://news.example.com/crosswalk-upgrade</link>
  <pubDate>Wed, 09 Sep 2026 19:59:35 +0000</pubDate>
  <category><![CDATA[Local News]]></category>
  <content:encoded><![CDATA[<p>The City of Fremont will repaint the crosswalk
  on <b>Example Street</b>.</p>]]></content:encoded>
</item>
<item>
  <title>Best of Shopping 2026</title>
  <link>https://news.example.com/best-of-shopping</link>
  <pubDate>Tue, 08 Sep 2026 07:00:00 +0000</pubDate>
  <category><![CDATA[Best of Shopping]]></category>
  <content:encoded><![CDATA[<p>Fremont readers voted.</p>]]></content:encoded>
</item>
<item>
  <title>Union City fair returns</title>
  <link>https://news.example.com/union-city-fair</link>
  <pubDate>Tue, 08 Sep 2026 07:00:00 +0000</pubDate>
  <category><![CDATA[Community]]></category>
  <content:encoded><![CDATA[<p>The fair is in Union City.</p>]]></content:encoded>
</item>
<item>
  <title>Countywide plan released</title>
  <link>https://transit.example.org/countywide-plan</link>
  <pubDate>Wed, 22 Jul 2026 22:14:13 +0000</pubDate>
  <category>News</category>
</item>
</channel></rss>"""


def source(**params) -> Source:
    return Source(
        "example", "Example News", "https://news.example.com/feed/", "news", "rss_feed", "rss_feed", True, params=params
    )


def artifact() -> Artifact:
    return Artifact(
        url="https://news.example.com/feed/",
        final_url="https://news.example.com/feed/",
        status=200,
        content_type="application/rss+xml",
        raw=FEED,
        text=None,
        fetched_at=datetime.now(UTC),
        fetcher="http",
        content_hash="",
    )


class RssFeedTests(unittest.TestCase):
    def test_fremont_filter_and_excluded_categories(self):
        refs = _rss_feed(source(mention_terms=["Fremont"], exclude_category_prefixes=["best of"]), artifact())
        self.assertEqual([ref.title for ref in refs], ["Crosswalk upgrade planned near Fremont school"])
        ref = refs[0]
        self.assertEqual(ref.doc_type, "news")
        self.assertEqual(ref.published_at, datetime(2026, 9, 9, 12, 59, 35))  # 19:59 UTC is 12:59 in Fremont
        self.assertEqual(
            ref.inline_text,
            "# Crosswalk upgrade planned near Fremont school\n\n"
            "The City of Fremont will repaint the crosswalk on Example Street .",
        )
        self.assertEqual(ref.locator, "article")

    def test_items_without_article_text_are_fetched_from_their_link(self):
        refs = _rss_feed(source(), artifact())
        plan = next(ref for ref in refs if ref.title == "Countywide plan released")
        self.assertIsNone(plan.inline_text)
        self.assertEqual(plan.url, "https://transit.example.org/countywide-plan")
        self.assertEqual(len(refs), 4)


if __name__ == "__main__":
    unittest.main()
