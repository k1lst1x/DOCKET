# DOCKET judge guide

> Replace the bracketed values before submitting.

## Links

- Live demo: [live demo URL]
- Demo video: [YouTube or Vimeo URL]
- Source repository: [repository URL]

## Test path

1. Open the live demo and choose a Fremont neighborhood.
2. Open **Places** to see neighborhood context and civic locations.
3. Open an issue to read its source-linked details and community discussion.
4. Add a community vote or review after signing in, if sign-in is enabled for
   the demo.
5. Open the chat assistant and ask a Fremont civic question, for example:
   `What transportation plans affect Mission San Jose?`
6. Confirm that the response streams and includes numbered source citations.

## What the demo proves

- The Strands chat agent retrieves evidence before answering.
- The AgentCore pipeline can ingest public records and create verified civic
  outputs in the background.
- The resident interface reads civic data, neighborhood data, and community
  participation data without exposing AWS credentials in the browser.

## Data note

The application clearly labels any demo or sample civic records. Source-linked
agent outputs identify their underlying public documents so a resident can check
the original record.

## Local fallback

For a local review, follow the setup steps in the repository README. Run the
Python API on port 8000 and set this server-only value in
`frontend/.env.local`:

```bash
DOCKET_CHAT_URL=http://localhost:8000/chat
```

The local backend requires configured AWS credentials plus the DSQL and S3
environment values in `backend/.env` to answer against the real corpus.
