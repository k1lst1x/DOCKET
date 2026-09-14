"""Step 5 check: the chat agent end to end with citations, against the real corpus.

Each question gets its own session, plus one follow-up in the first session to show that the conversation
carries over while every answer is still grounded in evidence retrieved that turn.
"""

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
FOLLOW_UP = "Which company is that agreement with?"


async def ask(question: str, session: str | None) -> str:
    response = await answer(question, session_id=session, user_id="step5-check")
    print(f"\n=== Q: {question}")
    print(f"session={response.session_id} refused={response.refused}")
    print(f"answer: {response.answer}")
    for citation in response.citations:
        print(f"  [{citation.ref}] {citation.title} | {citation.locator} | {citation.url}")
    if response.removed_sentences:
        print("removed by enforcement:", json.dumps(response.removed_sentences, indent=1, ensure_ascii=False))
    return response.session_id


async def main() -> None:
    questions = sys.argv[1:] or QUESTIONS
    first_session = await ask(questions[0], None)
    if not sys.argv[1:]:
        await ask(FOLLOW_UP, first_session)
    for question in questions[1:]:
        await ask(question, None)


if __name__ == "__main__":
    asyncio.run(main())
