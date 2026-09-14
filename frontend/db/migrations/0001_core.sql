-- Docket core schema for Amazon Aurora DSQL.
-- Shared by two writers:
--   web app (Next.js server): members, memberships, votes, reviews
--   reading agent (backend/): neighborhoods, groups, issues, issue_analyses, polls
--
-- DSQL rules this file follows:
--   * one DDL statement per transaction (scripts/dsql-migrate.mjs runs each statement alone)
--   * no triggers, PL/pgSQL, extensions or array columns: lists are jsonb arrays
--   * secondary indexes use CREATE INDEX ASYNC
--   * CASCADE only where child rows are few (the 3,000-row transaction limit applies)
-- Statements are separated by a line ending in a semicolon.

CREATE TABLE IF NOT EXISTS neighborhoods (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL UNIQUE,
  boundary jsonb NOT NULL CHECK (jsonb_typeof(boundary) = 'array'),
  centroid jsonb,
  area_km2 numeric,
  source text NOT NULL DEFAULT 'City of Fremont Neighborhoods GIS layer'
);

CREATE TABLE IF NOT EXISTS groups (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL,
  neighborhood_slug text NOT NULL REFERENCES neighborhoods (slug),
  description text NOT NULL,
  watchlist jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(watchlist) = 'array'),
  meets text,
  founded_on date,
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS issues (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ref text NOT NULL,
  group_slug text REFERENCES groups (slug) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL,
  meeting_at timestamptz,
  deadline timestamptz,
  deadline_kind text,
  topic text,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'watching', 'decided', 'dismissed')),
  location jsonb,
  affected_radius_m integer CHECK (affected_radius_m > 0),
  neighborhood_slugs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(neighborhood_slugs) = 'array'),
  source_url text,
  citation text,
  is_sample boolean NOT NULL DEFAULT false,
  surfaced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- pros/cons: [{"text", "basis": "source" | "inference", "citation"}]; facts: [{"label", "value"}]
CREATE TABLE IF NOT EXISTS issue_analyses (
  issue_id text PRIMARY KEY REFERENCES issues (id) ON DELETE CASCADE,
  summary text NOT NULL,
  pros jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(pros) = 'array'),
  cons jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(cons) = 'array'),
  facts jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(facts) = 'array'),
  model text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  is_sample boolean NOT NULL DEFAULT false
);

-- One stance poll per issue: stance_issue_id is set only for stance polls, and a
-- UNIQUE constraint ignores the NULLs on choice polls (DSQL has no partial indexes).
CREATE TABLE IF NOT EXISTS polls (
  id text PRIMARY KEY,
  issue_id text NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  question text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('stance', 'choice')),
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) >= 2),
  position smallint NOT NULL DEFAULT 0,
  stance_issue_id text GENERATED ALWAYS AS (CASE WHEN kind = 'stance' THEN issue_id END) STORED,
  UNIQUE (stance_issue_id)
);

-- id is the Cognito user "sub"; email mirrors the verified Cognito email.
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  verified_at timestamptz,
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  member_id uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  group_slug text NOT NULL REFERENCES groups (slug) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'coordinator')),
  topics jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(topics) = 'array'),
  other_topic text CHECK (char_length(other_topic) <= 120),
  can_speak_evenings boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, group_slug)
);

-- choice is one of the poll's option ids, or 'pass' on a stance poll. The app
-- validates the option id (DSQL has no triggers to check it against polls.options).
CREATE TABLE IF NOT EXISTS votes (
  poll_id text NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  choice text NOT NULL CHECK (char_length(choice) BETWEEN 1 AND 64),
  voter_neighborhood_slug text REFERENCES neighborhoods (slug),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, member_id)
);

-- Reviews unlock only after voting or passing: the composite foreign key makes a
-- review impossible unless the member's vote row on that stance poll exists.
-- The app always passes the issue's stance poll id as stance_poll_id.
CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id text NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  stance_poll_id text NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issue_id, member_id),
  FOREIGN KEY (stance_poll_id, member_id) REFERENCES votes (poll_id, member_id) ON DELETE CASCADE
);

CREATE INDEX ASYNC IF NOT EXISTS groups_neighborhood_idx ON groups (neighborhood_slug);

CREATE INDEX ASYNC IF NOT EXISTS issues_group_idx ON issues (group_slug);

CREATE INDEX ASYNC IF NOT EXISTS issues_deadline_idx ON issues (deadline);

CREATE INDEX ASYNC IF NOT EXISTS polls_issue_idx ON polls (issue_id);

CREATE INDEX ASYNC IF NOT EXISTS memberships_group_idx ON memberships (group_slug);

CREATE INDEX ASYNC IF NOT EXISTS votes_member_idx ON votes (member_id);

CREATE INDEX ASYNC IF NOT EXISTS reviews_issue_created_idx ON reviews (issue_id, created_at);

CREATE INDEX ASYNC IF NOT EXISTS reviews_member_idx ON reviews (member_id);
