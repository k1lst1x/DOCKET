# Hosting DOCKET's agents on Amazon Bedrock AgentCore

Two runtimes are defined in `agentcore/agentcore.json`:

| Runtime | Entrypoint | What it does |
|---|---|---|
| `docket_chat` | `agentcore_chat.py` | Resident chat agent, read-only tools, streams SSE |
| `docket_pipeline` | `agentcore_pipeline.py` | Ingest, job status and the generation graph |

Both run Python 3.11 as CodeZip in us-west-2, with OpenTelemetry on. Their IAM permissions come from `agentcore/policies/*.json`:

- Bedrock models.
- The DSQL cluster.
- The S3 Vectors index.
- Pipeline only: raw S3 writes and the Firecrawl secret.
- Bedrock role assumption is limited to the one `DocketBedrockAccess` role named by each runtime's `BEDROCK_ROLE_ARN` (currently account 576884310211, with `BEDROCK_EXTERNAL_ID`), or the deployment account's when unset. When the Bedrock account changes, update `agentcore.json` and both policy files together; `tests/test_api_security.py` checks they match.

## 0. Before you start

- Tools: Node 20+, `uv`, and the AgentCore CLI (`npm i -g @aws/agentcore`; this repo was built with 0.29.0).
- AWS credentials for account 465083445156:
  - Prefer an IAM Identity Center user or IAM role with admin rights for the deploy, not the root user.
  - `aws login` works, and the CLI reads the same credentials.
- CDK bootstrap for 465083445156 / us-west-2 is **already done**: the `CDKToolkit` stack was created on 2026-09-13.
  - In a new account or region, `agentcore deploy` bootstraps it for you.

## 1. Store the Firecrawl key in Secrets Manager (pipeline only)

The deployed pipeline reads the key from `docket/firecrawl` as a plain string. It never reads `.env`.

```powershell
aws secretsmanager create-secret --region us-west-2 --name docket/firecrawl --secret-string "fc-YOUR-KEY"
```

To rotate the key later: `aws secretsmanager put-secret-value --region us-west-2 --secret-id docket/firecrawl --secret-string "fc-NEW-KEY"`.

## 2. Check the project, then preview

From `backend/` (the project root; the CLI refuses to run from `agentcore/`):

```powershell
cd backend
agentcore validate          # expect: Valid
agentcore deploy --diff     # CloudFormation changes, nothing deployed
```

## 3. Deploy both runtimes

```powershell
agentcore deploy -y -v
```

This packages the code (`.env` and `.venv` are excluded), synthesizes CloudFormation, and creates both runtimes with their roles. Then:

```powershell
agentcore status --type agent   # copy the docket_chat runtime ARN
```

## 4. Smoke-test in AWS

```powershell
agentcore invoke --runtime docket_chat --session-id 7c0d6f7e-1b1a-4c55-9b43-2f1e6a1d5a10 "What did the September 8, 2026 City Council agenda include?"
agentcore invoke --runtime docket_pipeline --prompt-file status.json   # status.json: {"action": "status"}
```

What to expect:

- Chat streams `status`, `text`, then a `final` event with `citations` (or `refused: true` when the corpus has no evidence).
- Pipeline payloads:
  - `{"action":"ingest","sources":[...]}`
  - `{"action":"status","job_id":"..."}`
  - `{"action":"generate","topic":"...","kind":"summary"|"proscons"}`

Session IDs must be at least 33 characters (a UUID works).

## 5. Observability

```powershell
agentcore logs --runtime docket_chat
```

- Traces and spans go to CloudWatch (GenAI Observability → Bedrock AgentCore).
- Turn on CloudWatch Transaction Search once per account (CloudWatch → Settings → X-Ray traces → Transaction Search) so spans are indexed.

## 6. Connect the website's chat page and chat popup

Both the `/chat` page and the popup button use `frontend/src/components/chat/ChatPanel.tsx`, which calls `/api/chat`. That route calls `InvokeAgentRuntime` server-side, so no AWS keys ever reach the browser.

1. **Environment variable.** Amplify console → the app → Hosting → Environment variables:
   - Add `DOCKET_CHAT_RUNTIME_ARN` = the docket_chat ARN from step 3.
   - `amplify.yml` already passes it to the server runtime.
2. **Permissions for the Amplify SSR compute role.** This is the same role that already reaches DSQL. In IAM, add this inline policy, replacing `<runtime-id>`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": "bedrock-agentcore:InvokeAgentRuntime",
       "Resource": [
         "arn:aws:bedrock-agentcore:us-west-2:465083445156:runtime/<runtime-id>",
         "arn:aws:bedrock-agentcore:us-west-2:465083445156:runtime/<runtime-id>/runtime-endpoint/*"
       ]
     }]
   }
   ```

3. **Redeploy.** Push to `main` (or click Redeploy). Open `/chat` and the popup, and ask a question. You should see streamed text and numbered sources.

The route's protections:

- It accepts only same-origin requests.
- It rate-limits to 20 requests per client and 300 overall.
- It scopes sessions to the signed-in member: another user's `session_id` starts a fresh conversation.

### Local testing without deploying

```powershell
cd backend; uv run uvicorn api.main:app --port 8000
# frontend/.env.local:  DOCKET_CHAT_URL=http://127.0.0.1:8000/chat
cd frontend; npm run dev
```

`DOCKET_CHAT_URL` is honored only for localhost. With neither variable set, the panel shows "not connected".

## 7. Updating and removing

- Update: change the code, then `agentcore deploy -y` again. It updates the same runtimes and keeps their ARNs.
- Remove: `agentcore remove agent` for each runtime, then `agentcore deploy -y`. The shared DSQL cluster and S3 buckets are not part of this stack and are left alone.
