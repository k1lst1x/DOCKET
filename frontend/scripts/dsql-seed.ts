// Loads reference and SAMPLE data into Aurora DSQL. Safe to re-run.
//   * all 32 official Fremont neighborhood areas
//   * sample groups, issues, AI analyses and polls (is_sample = true)
//   * 100 sample members with memberships, votes and reviews, so charts have data
// Real members, votes and reviews are never touched: sample rows use fixed ids.
//
// Usage (from frontend/, Node 22.18+ runs TypeScript directly):
//   DSQL_ENDPOINT=<cluster>.dsql.us-west-2.on.aws node scripts/dsql-seed.ts

import { AuroraDSQLClient } from "@aws/aurora-dsql-node-postgres-connector";
import { GROUP_SEEDS, ITEMS } from "../src/data/fixtures.ts";
import neighborhoods from "../src/data/fremont-neighborhoods.json" with { type: "json" };
import { ISSUE_CONTENT } from "../src/data/issue-content.ts";
import { SAMPLE_ACTIVITY, SAMPLE_FIRST_NAMES, SAMPLE_LAST_INITIALS } from "../src/data/sample-activity.ts";
import { SAMPLE_POSTS, samplePostId, sampleReplyId } from "../src/data/sample-posts.ts";
import { sampleIssueId } from "../src/lib/issue-ids.ts";

const endpoint = process.env.DSQL_ENDPOINT;
if (!endpoint) {
  console.error("Set DSQL_ENDPOINT to the cluster endpoint, e.g. abc123.dsql.us-west-2.on.aws");
  process.exit(1);
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Deterministic PRNG so re-running the seed produces the same sample activity. */
function rng(seedText: string) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const weighted = (rand: () => number, weights: number[]) => {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return i;
  return weights.length - 1;
};

const client = new AuroraDSQLClient({ host: endpoint, user: process.env.DSQL_USER ?? "admin" });
await client.connect();

/** One multi-row upsert per call, via jsonb_to_recordset (DSQL-friendly: one statement). */
async function upsertRows(table: string, columns: string, rows: object[], conflict: string) {
  if (!rows.length) return;
  await client.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO ${table} SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(${columns}) ${conflict}`,
      [JSON.stringify(rows)],
    );
  });
}

try {
  // ---------------------------------------------------------------- reference
  await upsertRows(
    "neighborhoods (slug, name, boundary, centroid, area_km2)",
    "slug text, name text, boundary jsonb, centroid jsonb, area_km2 numeric",
    neighborhoods.map((n) => ({ slug: n.slug, name: n.name, boundary: n.polygon, centroid: n.centroid, area_km2: n.areaKm2 })),
    "ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, boundary = EXCLUDED.boundary, centroid = EXCLUDED.centroid, area_km2 = EXCLUDED.area_km2",
  );

  await upsertRows(
    "groups (slug, name, neighborhood_slug, description, watchlist, meets, founded_on, is_sample)",
    "slug text, name text, neighborhood_slug text, description text, watchlist jsonb, meets text, founded_on date, is_sample boolean",
    // Real neighborhood groups (migration 0006) use the neighborhood's slug; never overwrite one with a
    // sample seed that happens to share it (mission-san-jose).
    GROUP_SEEDS.filter((g) => g.slug !== slugOf(g.district)).map((g) => ({
      slug: g.slug,
      name: g.name,
      neighborhood_slug: slugOf(g.district),
      description: g.description,
      watchlist: g.watchlist,
      meets: g.meets,
      founded_on: g.foundedOn,
      is_sample: true,
    })),
    `ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, neighborhood_slug = EXCLUDED.neighborhood_slug,
       description = EXCLUDED.description, watchlist = EXCLUDED.watchlist, meets = EXCLUDED.meets, founded_on = EXCLUDED.founded_on`,
  );

  // ------------------------------------------------------- issues and analyses
  const contentByItem = new Map(ISSUE_CONTENT.map((c) => [c.itemId, c]));
  const issueItems = ITEMS.filter((i) => contentByItem.has(i.id));

  await upsertRows(
    `issues (id, ref, group_slug, title, body, meeting_at, deadline, deadline_kind, topic, status, location,
             affected_radius_m, neighborhood_slugs, source_url, citation, is_sample, surfaced_at, updated_at)`,
    `id text, ref text, group_slug text, title text, body text, meeting_at timestamptz, deadline timestamptz, deadline_kind text,
     topic text, status text, location jsonb, affected_radius_m integer, neighborhood_slugs jsonb, source_url text, citation text,
     is_sample boolean, surfaced_at timestamptz, updated_at timestamptz`,
    issueItems.map((item) => {
      const content = contentByItem.get(item.id);
      if (!content) throw new Error(`missing content for ${item.id}`);
      return {
        id: sampleIssueId(item.ref),
        ref: item.ref,
        group_slug: item.groupSlug,
        title: item.title,
        body: item.body,
        meeting_at: item.meetingAt,
        deadline: item.deadline,
        deadline_kind: item.deadlineKind,
        topic: item.topic,
        status: item.status,
        location: content.location,
        affected_radius_m: content.affectedRadiusM,
        neighborhood_slugs: content.neighborhoods.map(slugOf),
        source_url: null,
        citation: item.citation,
        is_sample: true,
        surfaced_at: item.surfacedAt,
        updated_at: new Date().toISOString(),
      };
    }),
    `ON CONFLICT (id) DO UPDATE SET ref = EXCLUDED.ref, group_slug = EXCLUDED.group_slug, title = EXCLUDED.title, body = EXCLUDED.body,
       meeting_at = EXCLUDED.meeting_at, deadline = EXCLUDED.deadline, deadline_kind = EXCLUDED.deadline_kind, topic = EXCLUDED.topic,
       status = EXCLUDED.status, location = EXCLUDED.location, affected_radius_m = EXCLUDED.affected_radius_m,
       neighborhood_slugs = EXCLUDED.neighborhood_slugs, citation = EXCLUDED.citation, surfaced_at = EXCLUDED.surfaced_at,
       updated_at = EXCLUDED.updated_at`,
  );

  await upsertRows(
    "issue_analyses (issue_id, summary, pros, cons, facts, model, generated_at, is_sample)",
    "issue_id text, summary text, pros jsonb, cons jsonb, facts jsonb, model text, generated_at timestamptz, is_sample boolean",
    issueItems.map((item) => {
      const c = contentByItem.get(item.id);
      return {
        issue_id: sampleIssueId(item.ref),
        summary: c?.summary,
        pros: c?.pros,
        cons: c?.cons,
        facts: c?.facts,
        model: "sample (hand-written)",
        generated_at: item.surfacedAt,
        is_sample: true,
      };
    }),
    `ON CONFLICT (issue_id) DO UPDATE SET summary = EXCLUDED.summary, pros = EXCLUDED.pros, cons = EXCLUDED.cons,
       facts = EXCLUDED.facts, model = EXCLUDED.model, generated_at = EXCLUDED.generated_at`,
  );

  const pollRows = issueItems.flatMap((item) => {
    const c = contentByItem.get(item.id);
    const issueId = sampleIssueId(item.ref);
    if (!c) return [];
    return [
      {
        id: `${issueId}-stance`,
        issue_id: issueId,
        question: c.stanceQuestion,
        kind: "stance",
        options: [
          { id: "support", label: "Support" },
          { id: "oppose", label: "Oppose" },
        ],
        position: 0,
      },
      ...c.choicePolls.map((p, i) => ({ id: `${issueId}-${p.id}`, issue_id: issueId, question: p.question, kind: "choice", options: p.options, position: i + 1 })),
    ];
  });
  await upsertRows(
    "polls (id, issue_id, question, kind, options, position)",
    "id text, issue_id text, question text, kind text, options jsonb, position smallint",
    pollRows,
    "ON CONFLICT (id) DO UPDATE SET question = EXCLUDED.question, options = EXCLUDED.options, position = EXCLUDED.position",
  );

  // ---------------------------------------------------------- sample members
  const members = Array.from({ length: 100 }, (_, i) => {
    const group = GROUP_SEEDS[i % GROUP_SEEDS.length];
    return {
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      name: `${SAMPLE_FIRST_NAMES[i % SAMPLE_FIRST_NAMES.length]} ${SAMPLE_LAST_INITIALS[(i * 7) % SAMPLE_LAST_INITIALS.length]}.`,
      email: `sample-${i + 1}@docket.invalid`,
      group,
      neighborhood: slugOf(group.district),
    };
  });

  await upsertRows(
    "members (id, name, email, verified_at, is_sample)",
    "id uuid, name text, email text, verified_at timestamptz, is_sample boolean",
    members.map((m) => ({ id: m.id, name: m.name, email: m.email, verified_at: "2026-08-01T00:00:00Z", is_sample: true })),
    "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name",
  );

  await upsertRows(
    "memberships (member_id, group_slug, role, topics, other_topic, can_speak_evenings)",
    "member_id uuid, group_slug text, role text, topics jsonb, other_topic text, can_speak_evenings boolean",
    members.map((m, i) => {
      const rand = rng(`membership-${m.id}`);
      return {
        member_id: m.id,
        group_slug: m.group.slug,
        role: i < GROUP_SEEDS.length ? "coordinator" : "member",
        topics: m.group.watchlist.filter(() => rand() < 0.4),
        other_topic: null,
        can_speak_evenings: rand() < 0.3,
      };
    }),
    "ON CONFLICT (member_id, group_slug) DO NOTHING",
  );

  // ----------------------------------------------------- sample votes, reviews
  const now = Date.now();
  const votes: object[] = [];
  const reviews: object[] = [];

  for (const item of issueItems) {
    const content = contentByItem.get(item.id);
    const activity = SAMPLE_ACTIVITY[item.id];
    if (!content || !activity) continue;
    const issueId = sampleIssueId(item.ref);
    const affected = new Set(content.neighborhoods.map(slugOf));
    const eligible = members.filter((m) => m.group.slug === item.groupSlug || (affected.size > 1 && affected.has(m.neighborhood)));
    const rand = rng(`votes-${issueId}`);
    const start = Date.parse(item.surfacedAt);
    const end = Math.min(now, Date.parse(item.deadline));
    const stanceOf = new Map<string, string>();

    for (const m of eligible) {
      if (rand() > activity.turnout) continue;
      const choice = rand() < activity.passRate ? "pass" : rand() < activity.support ? "support" : "oppose";
      // Earlier days get more votes, like a real notice going out.
      const at = new Date(start + (end - start) * rand() ** 1.6).toISOString();
      stanceOf.set(m.id, choice);
      votes.push({ poll_id: `${issueId}-stance`, member_id: m.id, choice, voter_neighborhood_slug: m.neighborhood, created_at: at, updated_at: at });

      for (const poll of content.choicePolls) {
        if (choice === "pass" || rand() > 0.7) continue;
        const weights = activity.choiceWeights[poll.id] ?? poll.options.map(() => 1);
        const option = poll.options[weighted(rand, weights)];
        votes.push({ poll_id: `${issueId}-${poll.id}`, member_id: m.id, choice: option.id, voter_neighborhood_slug: m.neighborhood, created_at: at, updated_at: at });
      }
    }

    const used = new Set<string>();
    activity.reviews.forEach((review, index) => {
      const author =
        [...stanceOf.entries()].find(([id, stance]) => stance === review.stance && !used.has(id))?.[0] ??
        [...stanceOf.keys()].find((id) => !used.has(id));
      if (!author) return;
      used.add(author);
      const at = new Date(Math.min(now, start + (end - start) * (0.3 + 0.2 * index))).toISOString();
      reviews.push({ issue_id: issueId, member_id: author, stance_poll_id: `${issueId}-stance`, rating: review.rating, body: review.body, created_at: at, updated_at: at });
    });
  }

  await upsertRows(
    "votes (poll_id, member_id, choice, voter_neighborhood_slug, created_at, updated_at)",
    "poll_id text, member_id uuid, choice text, voter_neighborhood_slug text, created_at timestamptz, updated_at timestamptz",
    votes,
    `ON CONFLICT (poll_id, member_id) DO UPDATE SET choice = EXCLUDED.choice, voter_neighborhood_slug = EXCLUDED.voter_neighborhood_slug,
       created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
  );

  await upsertRows(
    "reviews (issue_id, member_id, stance_poll_id, rating, body, created_at, updated_at)",
    "issue_id text, member_id uuid, stance_poll_id text, rating smallint, body text, created_at timestamptz, updated_at timestamptz",
    reviews,
    `ON CONFLICT (issue_id, member_id) DO UPDATE SET stance_poll_id = EXCLUDED.stance_poll_id, rating = EXCLUDED.rating,
       body = EXCLUDED.body, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
  );

  // ---------------------------------------------------------------- home feed
  // Timestamps are relative to when the seed runs, so the sample feed looks current.
  const seededAt = Date.now();
  const postTime = (hoursAgo: number, minutesAfter = 0) => new Date(seededAt - hoursAgo * 3_600_000 + minutesAfter * 60_000).toISOString();
  const postColumns = "id uuid, member_id uuid, neighborhood_slug text, parent_id uuid, body text, is_sample boolean, created_at timestamptz";
  const postConflict = "ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, neighborhood_slug = EXCLUDED.neighborhood_slug, created_at = EXCLUDED.created_at";

  await upsertRows(
    "posts (id, member_id, neighborhood_slug, parent_id, body, is_sample, created_at)",
    postColumns,
    SAMPLE_POSTS.map((p, i) => ({
      id: samplePostId(i),
      member_id: members[p.author].id,
      neighborhood_slug: p.neighborhood,
      parent_id: null,
      body: p.body,
      is_sample: true,
      created_at: postTime(p.hoursAgo),
    })),
    postConflict,
  );
  await upsertRows(
    "posts (id, member_id, neighborhood_slug, parent_id, body, is_sample, created_at)",
    postColumns,
    SAMPLE_POSTS.flatMap((p, i) =>
      p.replies.map((r, j) => ({
        id: sampleReplyId(i, j),
        member_id: members[r.author].id,
        neighborhood_slug: p.neighborhood,
        parent_id: samplePostId(i),
        body: r.body,
        is_sample: true,
        created_at: postTime(p.hoursAgo, r.minutesAfter),
      })),
    ),
    postConflict,
  );
  await upsertRows(
    "post_likes (post_id, member_id, created_at)",
    "post_id uuid, member_id uuid, created_at timestamptz",
    SAMPLE_POSTS.flatMap((p, i) => {
      const rand = rng(`likes-${i}`);
      const likers = members
        .filter((_, m) => m !== p.author)
        .map((m) => ({ m, key: rand() }))
        .sort((a, b) => a.key - b.key)
        .slice(0, p.likes);
      return likers.map(({ m }) => ({ post_id: samplePostId(i), member_id: m.id, created_at: postTime(p.hoursAgo, 5) }));
    }),
    "ON CONFLICT (post_id, member_id) DO NOTHING",
  );

  const { rows } = await client.query(
    `SELECT (SELECT count(*) FROM neighborhoods)::int AS neighborhoods, (SELECT count(*) FROM groups)::int AS groups,
            (SELECT count(*) FROM issues)::int AS issues, (SELECT count(*) FROM polls)::int AS polls,
            (SELECT count(*) FROM members WHERE is_sample)::int AS sample_members,
            (SELECT count(*) FROM votes)::int AS votes, (SELECT count(*) FROM reviews)::int AS reviews,
            (SELECT count(*) FROM posts)::int AS posts, (SELECT count(*) FROM post_likes)::int AS post_likes`,
  );
  console.log("seeded:", rows[0]);
} finally {
  await client.end();
}
