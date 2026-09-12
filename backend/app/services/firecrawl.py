"""Single-page ingestion. Run with `python -m app.services.firecrawl URL`."""

import argparse
import json

from firecrawl import Firecrawl
from firecrawl.v2.types import Document
from pydantic import HttpUrl, TypeAdapter

from app.core.config import Settings


def scrape_page(url: str, settings: Settings | None = None) -> Document:
    settings = settings or Settings()
    key = settings.firecrawl_api_key
    if key is None or not key.get_secret_value().strip():
        raise ValueError("Set DOCKET_FIRECRAWL_API_KEY in backend/.env")
    validated_url = str(TypeAdapter(HttpUrl).validate_python(url))
    client = Firecrawl(api_key=key.get_secret_value(), timeout=60, max_retries=0)
    document = client.scrape(validated_url, formats=["markdown"], only_main_content=True)
    if not document.markdown or not document.markdown.strip():
        raise ValueError("Firecrawl returned no markdown content")
    if document.metadata and document.metadata.status_code:
        if document.metadata.status_code >= 400:
            raise ValueError("The source page returned an error status")
    return document


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Check Firecrawl with one page (uses API credits)."
    )
    parser.add_argument("url", help="Public page to scrape")
    args = parser.parse_args()
    try:
        document = scrape_page(args.url)
    except Exception as error:
        # Do not print provider exceptions that may contain credentials or request details.
        parser.exit(
            1, f"Firecrawl check failed ({type(error).__name__}). Check key, quota and URL.\n"
        )
    print(
        json.dumps(
            {
                "success": True,
                "title": document.metadata.title if document.metadata else None,
                "source_status": document.metadata.status_code if document.metadata else None,
                "markdown_characters": len(document.markdown),
            }
        )
    )


if __name__ == "__main__":
    main()
