-- Photos and videos on home feed posts.
-- media is a JSON array of uploads kept in the private media bucket (see scripts/aws-media-bucket.sh):
--   [{ "kind": "image" | "video", "key": "uploads/<member>/<uuid>.<ext>", "contentType", "size", "width", "height", "durationS" }]
-- A post with photos or a video may have no text, so the 1–500 character check moves into the app
-- (validatePostBody). DSQL can drop a constraint but not add one, and each DDL statement runs on its own.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS media jsonb;

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_body_check;
