-- Automatic content checks for photos and videos in posts (Amazon Rekognition), one row per uploaded file.
-- status: pending (a video check is still running), approved, blocked (reasons say why) or failed (couldn't be checked).
-- Neighbors only ever see approved files. The checks are declared here because DSQL can't ADD CONSTRAINT later.

CREATE TABLE IF NOT EXISTS media_reviews (
  object_key text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image', 'video')),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'blocked', 'failed')),
  reasons jsonb NOT NULL,
  job_id text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
