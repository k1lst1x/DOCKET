-- Meeting outcomes and public-comment sentiment, derived from documents in the corpus.
-- Written only by the pipeline; the web app reads them. Same DSQL rules as 0001: one DDL statement per
-- transaction, CHECK constraints inside CREATE TABLE (DSQL cannot add them later), CREATE INDEX ASYNC.

-- One row per decided agenda item, only when minutes or an official action document state the outcome.
CREATE TABLE IF NOT EXISTS agent_meeting_outcomes (
  id text PRIMARY KEY,
  issue_id text,
  body text NOT NULL CHECK (body IN ('city_council', 'planning_commission', 'zoning_administrator', 'school_board')),
  meeting_date date NOT NULL,
  item_label text NOT NULL,
  title text NOT NULL,
  neighborhood_slugs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(neighborhood_slugs) = 'array'),
  result text NOT NULL CHECK (result IN ('approved', 'denied', 'continued', 'referred', 'received', 'no_action')),
  action_text text NOT NULL,
  vote jsonb,
  source_url text NOT NULL,
  citation jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- One row per agenda item (or application) that received filed public comments. Counts are recomputed
-- from agent_comments each run.
CREATE TABLE IF NOT EXISTS agent_comment_topics (
  id text PRIMARY KEY,
  issue_id text,
  body text NOT NULL CHECK (body IN ('city_council', 'planning_commission', 'zoning_administrator', 'school_board')),
  meeting_date date NOT NULL,
  item_label text NOT NULL,
  title text NOT NULL,
  neighborhood_slugs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(neighborhood_slugs) = 'array'),
  comment_count integer NOT NULL CHECK (comment_count >= 0),
  support_count integer NOT NULL CHECK (support_count >= 0),
  oppose_count integer NOT NULL CHECK (oppose_count >= 0),
  mixed_count integer NOT NULL CHECK (mixed_count >= 0),
  neutral_count integer NOT NULL CHECK (neutral_count >= 0),
  themes jsonb NOT NULL DEFAULT '[]',
  source_url text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  model text NOT NULL
);

-- One row per filed comment. No names: author_area is only what the writer said about where they live.
-- excerpt is verbatim from the cited chunk except that emails, phone numbers and street addresses are
-- replaced with "[redacted]".
CREATE TABLE IF NOT EXISTS agent_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id text NOT NULL REFERENCES agent_comment_topics (id),
  stance text NOT NULL CHECK (stance IN ('support', 'oppose', 'mixed', 'neutral')),
  sent_at timestamptz,
  author_area text,
  excerpt text NOT NULL CHECK (char_length(excerpt) BETWEEN 1 AND 300),
  chunk_id uuid NOT NULL REFERENCES agent_chunks (id),
  locator text NOT NULL
);

CREATE INDEX ASYNC IF NOT EXISTS agent_comments_topic_idx ON agent_comments (topic_id);

CREATE INDEX ASYNC IF NOT EXISTS agent_meeting_outcomes_issue_idx ON agent_meeting_outcomes (issue_id);
