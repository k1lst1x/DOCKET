import unittest
from unittest.mock import patch

from firecrawl.v2.types import Document
from pydantic import SecretStr

from app.core.config import Settings
from app.services.firecrawl import scrape_page


class FirecrawlTests(unittest.TestCase):
    def setUp(self):
        self.settings = Settings(_env_file=None, firecrawl_api_key=SecretStr("test-key"))

    @patch("app.services.firecrawl.Firecrawl")
    def test_missing_key_never_calls_provider(self, client):
        with self.assertRaisesRegex(ValueError, "DOCKET_FIRECRAWL_API_KEY"):
            scrape_page("https://example.com", Settings(_env_file=None, firecrawl_api_key=None))
        client.assert_not_called()

    @patch("app.services.firecrawl.Firecrawl")
    def test_scrape_and_secret_masking(self, client):
        client.return_value.scrape.return_value = Document(markdown="# Council meeting")
        document = scrape_page("https://example.com/meeting", self.settings)
        self.assertEqual(document.markdown, "# Council meeting")
        self.assertNotIn("test-key", repr(self.settings))
        client.return_value.scrape.assert_called_once_with(
            "https://example.com/meeting", formats=["markdown"], only_main_content=True
        )

    @patch("app.services.firecrawl.Firecrawl")
    def test_rejects_empty_or_failed_source(self, client):
        for data in [
            {"markdown": " "},
            {"markdown": "Not found", "metadata": {"status_code": 404}},
        ]:
            with self.subTest(data=data):
                client.return_value.scrape.return_value = Document.model_validate(data)
                with self.assertRaises(ValueError):
                    scrape_page("https://example.com", self.settings)

    @patch("app.services.firecrawl.Firecrawl")
    def test_rejects_non_http_url(self, client):
        with self.assertRaises(ValueError):
            scrape_page("file:///etc/passwd", self.settings)
        client.assert_not_called()
