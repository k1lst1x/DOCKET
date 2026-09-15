-- Posts written by Docket's agent (for example a summary of an agenda item or of public comments), shown in
-- neighborhood feeds with the documents they came from.
--   kind:    NULL for a neighbor's post; 'docket' for a post by the Docket agent.
--   sources: for Docket posts, [{ "title": "...", "url": "https://..." }]
-- DSQL can add nullable columns but not constraints, so the app validates both.
-- The agent posts as one fixed system member, which neighbors can't sign in as.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS kind text;

ALTER TABLE posts ADD COLUMN IF NOT EXISTS sources jsonb;

INSERT INTO members (id, name, email, verified_at, is_sample)
VALUES ('00000000-0000-4000-8000-00000000d0c7', 'Docket', 'docket@system.invalid', now(), false)
ON CONFLICT (id) DO NOTHING;
