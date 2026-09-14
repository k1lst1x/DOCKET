import json
import os
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from api.main import app


class PipelineAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.original = os.environ.get("DOCKET_PIPELINE_API_TOKEN")
        os.environ["DOCKET_PIPELINE_API_TOKEN"] = "test-operator-token"

    def tearDown(self):
        if self.original is None:
            os.environ.pop("DOCKET_PIPELINE_API_TOKEN", None)
        else:
            os.environ["DOCKET_PIPELINE_API_TOKEN"] = self.original

    def test_pipeline_endpoints_reject_missing_or_wrong_token(self):
        for path, payload in (
            ("/generate", {"topic": "Budget", "kind": "summary"}),
            ("/ingest/run", {}),
        ):
            self.assertEqual(self.client.post(path, json=payload).status_code, 401)
            self.assertEqual(self.client.post(path, json=payload, headers={"Authorization": "Bearer wrong"}).status_code, 401)

    def test_pipeline_endpoints_fail_closed_when_token_is_not_configured(self):
        os.environ.pop("DOCKET_PIPELINE_API_TOKEN")
        response = self.client.post("/generate", json={"topic": "Budget", "kind": "summary"})
        self.assertEqual(response.status_code, 401)

    def test_generate_reaches_graph_with_valid_operator_token(self):
        with patch("api.main.run_generation", new=AsyncMock(return_value={"status": "ok"})) as generate:
            response = self.client.post(
                "/generate",
                json={"topic": "Budget", "kind": "summary"},
                headers={"Authorization": "Bearer test-operator-token"},
            )
        self.assertEqual(response.status_code, 200)
        generate.assert_awaited_once_with("Budget", "summary", None, crawl=False)

    def test_ingest_reaches_runner_with_valid_operator_token(self):
        with patch("api.main.run_ingest", return_value={"run_id": "run-1", "counts": {}}) as ingest:
            response = self.client.post(
                "/ingest/run",
                json={"sources": ["fremont"], "max_docs": 2, "lookback_days": 7},
                headers={"Authorization": "Bearer test-operator-token"},
            )
        self.assertEqual(response.status_code, 200)
        ingest.assert_called_once_with(["fremont"], 2, 7)


class AgentCorePolicyTests(unittest.TestCase):
    def test_optional_bedrock_role_is_limited_to_the_deployment_account(self):
        root = Path(__file__).resolve().parents[1]
        target = json.loads((root / "agentcore" / "aws-targets.json").read_text(encoding="utf-8"))[0]
        account = target["account"]
        expected_role = f"arn:aws:iam::{account}:role/DocketBedrockAccess"

        for name in ("docket-chat.json", "docket-pipeline.json"):
            policy = json.loads((root / "agentcore" / "policies" / name).read_text(encoding="utf-8"))
            statement = next(item for item in policy["Statement"] if item["Action"] == ["sts:AssumeRole"])
            self.assertEqual(statement["Resource"], [expected_role])
            self.assertNotIn("*", statement["Resource"][0])


if __name__ == "__main__":
    unittest.main()
