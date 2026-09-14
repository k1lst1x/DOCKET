-- Real neighborhood groups: one group for each official Fremont neighborhood, with the neighborhood's slug and
-- name. They replace the prototype's five sample groups (niles-neighbors, irvington-commons,
-- centerville-together, warm-springs-hillside and mission-san-jose). The sample group rows stay, still
-- is_sample, so sample issues and posts keep their foreign keys. mission-san-jose already used its
-- neighborhood's slug, so it becomes the real group.
-- Real members' memberships move from the sample groups to the matching neighborhood group.

INSERT INTO groups (slug, name, neighborhood_slug, description, watchlist, meets, founded_on, is_sample)
SELECT n.slug, n.name, n.slug,
       'Neighbors in ' || n.name || ', one of Fremont''s 32 official neighborhoods.',
       '["Housing and development", "Traffic and street safety", "Parks and trails", "Public safety", "Schools", "Local business"]'::jsonb,
       NULL, DATE '2026-09-13', false
FROM neighborhoods n
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, neighborhood_slug = EXCLUDED.neighborhood_slug, description = EXCLUDED.description,
  watchlist = EXCLUDED.watchlist, meets = NULL, founded_on = EXCLUDED.founded_on, is_sample = false;

INSERT INTO memberships (member_id, group_slug, role, topics, other_topic, can_speak_evenings, joined_at)
SELECT ms.member_id,
       CASE ms.group_slug
         WHEN 'niles-neighbors' THEN 'niles'
         WHEN 'irvington-commons' THEN 'irvington'
         WHEN 'centerville-together' THEN 'centerville'
         WHEN 'warm-springs-hillside' THEN 'warm-springs'
       END,
       ms.role, ms.topics, ms.other_topic, ms.can_speak_evenings, ms.joined_at
FROM memberships ms JOIN members m ON m.id = ms.member_id
WHERE m.is_sample = false AND ms.group_slug IN ('niles-neighbors', 'irvington-commons', 'centerville-together', 'warm-springs-hillside')
ON CONFLICT (member_id, group_slug) DO NOTHING;

DELETE FROM memberships
WHERE group_slug IN ('niles-neighbors', 'irvington-commons', 'centerville-together', 'warm-springs-hillside')
  AND member_id IN (SELECT id FROM members WHERE is_sample = false);
