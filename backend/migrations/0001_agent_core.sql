-- DOCKET agent schema for Amazon Aurora DSQL: agent_* tables only.
-- Applied by backend/scripts/migrate.py and tracked in agent_schema_migrations.
-- The web app's tables (frontend/db/migrations) are never touched here.
--
-- DSQL rules this file follows:
--   * one DDL statement per transaction (the runner applies each statement alone)
--   * no triggers, PL/pgSQL, extensions or array columns: citation lists are join tables
--   * secondary indexes use CREATE INDEX ASYNC
--   * no CASCADE where child counts are unbounded (the 3,000-row transaction limit applies)
-- Embeddings live in Amazon S3 Vectors, keyed by agent_chunks.id.
-- Statements are separated by a line ending in a semicolon.

CREATE TABLE IF NOT EXISTS agent_sources (
  id text PRIMARY KEY,
  name text NOT NULL,
  url text NOT NULL,
  kind text NOT NULL,
  crawl_strategy text NOT NULL,
  robots_allowed boolean,
  last_crawled_at timestamptz,
  enabled boolean NOT NULL DEFAULT true
);

-- content_hash is the SHA-256 of the extracted document text; UNIQUE makes ingestion idempotent.
CREATE TABLE IF NOT EXISTS agent_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES agent_sources (id),
  url text NOT NULL,
  title text,
  published_at timestamptz,
  content_hash text NOT NULL UNIQUE,
  raw_s3_key text,
  doc_type text NOT NULL,
  fetched_at timestamptz NOT NULL
);

-- locator: "page N" for PDFs, "#heading-anchor" for HTML, "item <ref>" for listing records.
CREATE TABLE IF NOT EXISTS agent_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES agent_documents (id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  text text NOT NULL,
  locator text NOT NULL,
  token_count integer NOT NULL CHECK (token_count > 0),
  embedded_at timestamptz,
  UNIQUE (document_id, ordinal)
);

CREATE TABLE IF NOT EXISTS agent_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('summary', 'announcement', 'proscons')),
  topic text NOT NULL,
  group_id text,
  body_json jsonb NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  output_id uuid NOT NULL REFERENCES agent_outputs (id) ON DELETE CASCADE,
  claim_text text NOT NULL,
  verified_bool boolean NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_claim_chunks (
  claim_id uuid NOT NULL REFERENCES agent_claims (id) ON DELETE CASCADE,
  chunk_id uuid NOT NULL REFERENCES agent_chunks (id),
  PRIMARY KEY (claim_id, chunk_id)
);

CREATE TABLE IF NOT EXISTS agent_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id text,
  user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES agent_chat_sessions (id),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_message_chunks (
  message_id uuid NOT NULL REFERENCES agent_chat_messages (id) ON DELETE CASCADE,
  chunk_id uuid NOT NULL REFERENCES agent_chunks (id),
  PRIMARY KEY (message_id, chunk_id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  status text NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX ASYNC IF NOT EXISTS agent_documents_source_idx ON agent_documents (source_id);

CREATE INDEX ASYNC IF NOT EXISTS agent_documents_url_idx ON agent_documents (url);

CREATE INDEX ASYNC IF NOT EXISTS agent_claims_output_idx ON agent_claims (output_id);

CREATE INDEX ASYNC IF NOT EXISTS agent_claim_chunks_chunk_idx ON agent_claim_chunks (chunk_id);

CREATE INDEX ASYNC IF NOT EXISTS agent_chat_messages_session_idx ON agent_chat_messages (session_id, created_at);

CREATE INDEX ASYNC IF NOT EXISTS agent_message_chunks_chunk_idx ON agent_message_chunks (chunk_id);
