"""Offline checks for the chat turn plumbing behind answer speed and history (no AWS, no database)."""

import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from core import chat_agent, live_tools
from core.chat_agent import ChatResponse, final_text

SESSION = "11111111-1111-4111-8111-111111111111"


def general_response() -> ChatResponse:
    return ChatResponse(
        answer="Hello! Ask me about Fremont.",
        cited_chunk_ids=[],
        citations=[],
        refused=False,
        sources_searched=[],
        session_id=SESSION,
        grounded=False,
    )


class HistoryTests(unittest.TestCase):
    def test_each_question_comes_before_its_answer(self):
        # A turn's question and answer share created_at; the query breaks the tie so the newest answer is first.
        rows = [("assistant", "A2"), ("user", "Q2"), ("assistant", "A1"), ("user", "Q1")]
        with patch.object(chat_agent.retrieval, "_query", return_value=rows) as query:
            messages = chat_agent.load_history(SESSION)
        self.assertIn("CASE role WHEN 'assistant' THEN 0 ELSE 1 END", query.call_args.args[0])
        self.assertEqual([m["role"] for m in messages], ["user", "assistant", "user", "assistant"])
        self.assertEqual([m["content"][0]["text"] for m in messages], ["Q1", "A1", "Q2", "A2"])

    def test_a_new_conversation_skips_the_database(self):
        with patch.object(chat_agent.retrieval, "_query") as query:
            session, history = chat_agent.open_session(None, None)
        query.assert_not_called()
        self.assertEqual(history, [])
        self.assertTrue(session)


class FinalTextTests(unittest.TestCase):
    @staticmethod
    def result(text: str) -> SimpleNamespace:
        return SimpleNamespace(message={"content": [{"text": text}]})

    def test_reasoning_the_model_never_closed_is_not_shown(self):
        leaked = "<reasoning>Great, chunk 2 provides more items.\n\nThus answer list.\n- Item C [1]"
        self.assertEqual(final_text(self.result(leaked)), "")

    def test_closed_reasoning_is_removed_and_the_answer_kept(self):
        self.assertEqual(final_text(self.result("<reasoning>plan</reasoning>The answer [1].")), "The answer [1].")


class StreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_answer_is_sent_before_it_is_saved_and_the_next_turn_waits_for_the_save(self):
        release, saved = threading.Event(), threading.Event()

        def slow_persist(*args):
            release.wait(5)
            saved.set()

        async def fake_turn(question, session_id, user_id, progress):
            progress("Searching Fremont city documents")
            return general_response()

        with (
            patch.object(chat_agent, "_run_turn", fake_turn),
            patch.object(chat_agent, "persist_turn", slow_persist),
        ):
            events = [event async for event in chat_agent.stream_answer("hi")]
            self.assertEqual(events[-1]["type"], "final")
            self.assertIn({"type": "status", "message": "Searching Fremont city documents"}, events)
            self.assertFalse(saved.is_set())

            waiter = threading.Thread(target=chat_agent._wait_for_save, args=(SESSION,))
            waiter.start()
            time.sleep(0.05)
            self.assertTrue(waiter.is_alive())
            release.set()
            waiter.join(5)
            self.assertFalse(waiter.is_alive())
            self.assertTrue(saved.is_set())

    async def test_a_failed_turn_still_raises(self):
        async def failing_turn(question, session_id, user_id, progress):
            raise RuntimeError("model unavailable")

        with patch.object(chat_agent, "_run_turn", failing_turn):
            with self.assertRaises(RuntimeError):
                [event async for event in chat_agent.stream_answer("hi")]


class WarmUpTests(unittest.TestCase):
    def test_warm_up_never_raises(self):
        chat_agent._sources_cache = None
        self.addCleanup(setattr, chat_agent, "_sources_cache", None)
        with (
            patch.object(chat_agent.retrieval, "_query", side_effect=RuntimeError),
            patch.object(chat_agent.retrieval, "warm_keyword_index", side_effect=RuntimeError),
            patch.object(chat_agent.live_tools, "neighborhoods", side_effect=RuntimeError),
            patch.object(chat_agent, "_model", side_effect=RuntimeError),
            patch.object(chat_agent, "embed_text", side_effect=RuntimeError),
            patch.object(chat_agent.retrieval, "vector_store", side_effect=RuntimeError),
        ):
            chat_agent.warm()


class SecretCacheTests(unittest.TestCase):
    def setUp(self):
        live_tools.clear_cache()
        self.addCleanup(live_tools.clear_cache)

    def test_places_key_is_read_once_not_on_every_lookup(self):
        with patch.object(live_tools.settings, "google_places_api_key", return_value="key") as read:
            live_tools._places_key()
            live_tools._places_key()
        read.assert_called_once()


if __name__ == "__main__":
    unittest.main()
