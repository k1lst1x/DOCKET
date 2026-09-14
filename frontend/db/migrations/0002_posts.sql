-- Neighborhood feed on the home page: posts, one level of replies, and likes.
-- Written only by the web app. Same DSQL rules as 0001_core.sql: one DDL statement
-- per transaction, no triggers, secondary indexes with CREATE INDEX ASYNC.
-- Posts are soft-deleted (deleted_at), so replies and likes never cascade in bulk.

-- neighborhood_slug NULL means "All of Fremont". parent_id is set on replies and
-- always points at a top-level post (the app flattens reply chains).
CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  neighborhood_slug text REFERENCES neighborhoods (slug),
  parent_id uuid REFERENCES posts (id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, member_id)
);

CREATE INDEX ASYNC IF NOT EXISTS posts_created_idx ON posts (created_at);

CREATE INDEX ASYNC IF NOT EXISTS posts_neighborhood_created_idx ON posts (neighborhood_slug, created_at);

CREATE INDEX ASYNC IF NOT EXISTS posts_parent_created_idx ON posts (parent_id, created_at);

CREATE INDEX ASYNC IF NOT EXISTS posts_member_idx ON posts (member_id);

CREATE INDEX ASYNC IF NOT EXISTS post_likes_member_idx ON post_likes (member_id);
