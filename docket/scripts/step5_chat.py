"""Step 5 check: the chat agent end to end with citations, against the real corpus."""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.chat_agent import answer

QUESTIONS = [
    "What did the September 8, 2026 City Council agenda include for the security information system renewal?",
    "Am I allowed to build a second unit on my lot under Fremont zoning?",
    "What is Fremont's property tax rate for 2027?",
]


async def main() -> None:
    questions = sys.argv[1:] or QUESTIONS
    session = None
    for question in questions:
        response = await answer(question, session_id=session, user_id="step5-check")
        session = response.session_id
        print(f"\n=== Q: {question}")
        print(f"refused={response.refused}")
        print(f"answer: {response.answer}")
        for citation in response.citations:
            print(f"  [{citation.ref}] {citation.title} | {citation.locator} | {citation.url}")
        if response.removed_sentences:
            print("removed by enforcement:", json.dumps(response.removed_sentences, indent=1))


if __name__ == "__main__":
    asyncio.run(main())
