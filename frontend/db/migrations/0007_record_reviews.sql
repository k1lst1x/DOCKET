-- Neighbors' reviews of neighborhood records the reading agent stores in agent_documents: Fremont App
-- requests, city projects, development sites and police and city alerts. Text only, one per neighbor per
-- record, and no vote first (unlike agenda-item reviews). record_id has no foreign key: agent_documents
-- belongs to the backend, and the app checks the record exists before saving.
CREATE TABLE IF NOT EXISTS record_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL,
  member_id uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_id, member_id)
);

CREATE INDEX ASYNC IF NOT EXISTS record_reviews_record_idx ON record_reviews (record_id, created_at);
