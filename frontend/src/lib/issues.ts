import { db } from "./db";
import type { ClaimView, IssueActionErrorCode, IssueDetail, NeighborhoodShare, PollView, TrendPoint } from "./issue-types";

// Issue pages: AI analysis, polls, votes and reviews, all in Aurora DSQL.
// Rules:
//   * Members vote when they belong to the issue's group, or to a group whose
//     neighborhood the issue affects. One vote per poll per member (changeable).
//   * "pass" gives up the vote on the stance poll but still counts as taking part.
//   * Reviews are readable and writable only after voting or passing; the
//     database enforces this with a foreign key from reviews to votes.

export class IssueActionError extends Error {
  constructor(readonly code: IssueActionErrorCode) {
    super(code);
    this.name = "IssueActionError";
  }
}

const PUBLIC_STATUSES = "('watching', 'approved', 'decided')";

interface IssueRow {
  id: string;
  ref: string;
  title: string;
  body: string;
  topic: string | null;
  status: IssueDetail["status"];
  meeting_at: Date | null;
  deadline: Date | null;
  deadline_kind: string | null;
  citation: string | null;
  source_url: string | null;
  surfaced_at: Date;
  location: { lat: number; lng: number; label: string } | null;
  affected_radius_m: number | null;
  neighborhood_slugs: string[];
  is_sample: boolean;
  group_slug: string | null;
  group_name: string | null;
  summary: string | null;
  pros: ClaimView[] | null;
  cons: ClaimView[] | null;
  facts: { label: string; value: string }[] | null;
  model: string | null;
  generated_at: Date | null;
  analysis_sample: boolean | null;
}

interface MemberGroup {
  slug: string;
  name: string;
  neighborhood_slug: string;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

/** "Maria Lopez" -> "Maria L." */
function shortName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

let neighborhoodCache: { at: number; names: Map<string, string> } | undefined;
async function neighborhoodNames(): Promise<Map<string, string>> {
  if (neighborhoodCache && Date.now() - neighborhoodCache.at < 10 * 60_000) return neighborhoodCache.names;
  const { rows } = await db().query<{ slug: string; name: string }>("SELECT slug, name FROM neighborhoods");
  neighborhoodCache = { at: Date.now(), names: new Map(rows.map((r) => [r.slug, r.name])) };
  return neighborhoodCache.names;
}

async function memberGroups(query: (sql: string, params: unknown[]) => Promise<{ rows: MemberGroup[] }>, memberId: string) {
  const { rows } = await query(
    `SELECT g.slug, g.name, g.neighborhood_slug
     FROM memberships ms JOIN groups g ON g.slug = ms.group_slug
     WHERE ms.member_id = $1
     ORDER BY ms.joined_at`,
    [memberId],
  );
  return rows;
}

function eligibleGroup(groups: MemberGroup[], issue: { group_slug: string | null; neighborhood_slugs: string[] }) {
  return (
    groups.find((g) => g.slug === issue.group_slug) ??
    groups.find((g) => issue.neighborhood_slugs.includes(g.neighborhood_slug)) ??
    null
  );
}

const isClosed = (status: string, deadline: Date | null) =>
  status === "decided" || (deadline !== null && new Date(deadline).getTime() < Date.now());

export async function getIssueDetail(issueId: string, memberId: string | null): Promise<IssueDetail | null> {
  const pool = db();
  const query = <R>(sql: string, params: unknown[]) => pool.query<R & object>(sql, params) as unknown as Promise<{ rows: R[] }>;

  const { rows: issueRows } = await query<IssueRow>(
    `SELECT i.id, i.ref, i.title, i.body, i.topic, i.status, i.meeting_at, i.deadline, i.deadline_kind,
            i.citation, i.source_url, i.surfaced_at, i.location, i.affected_radius_m, i.neighborhood_slugs,
            i.is_sample, i.group_slug, g.name AS group_name,
            a.summary, a.pros, a.cons, a.facts, a.model, a.generated_at, a.is_sample AS analysis_sample
     FROM issues i
     LEFT JOIN groups g ON g.slug = i.group_slug
     LEFT JOIN issue_analyses a ON a.issue_id = i.id
     WHERE i.id = $1 AND i.status IN ${PUBLIC_STATUSES}`,
    [issueId],
  );
  const issue = issueRows[0];
  if (!issue) return null;

  const [polls, tallies, trendRows, hoodRows, ratingRows, myVotes, names, groups] = await Promise.all([
    query<{ id: string; question: string; kind: "stance" | "choice"; options: { id: string; label: string }[] }>(
      "SELECT id, question, kind, options FROM polls WHERE issue_id = $1 ORDER BY position, id",
      [issueId],
    ),
    query<{ poll_id: string; choice: string; n: number; sample_n: number }>(
      `SELECT v.poll_id, v.choice, count(*)::int AS n, sum(CASE WHEN m.is_sample THEN 1 ELSE 0 END)::int AS sample_n
       FROM votes v JOIN polls p ON p.id = v.poll_id JOIN members m ON m.id = v.member_id
       WHERE p.issue_id = $1
       GROUP BY v.poll_id, v.choice`,
      [issueId],
    ),
    query<{ day: string; choice: string; n: number }>(
      `SELECT to_char(v.created_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') AS day, v.choice, count(*)::int AS n
       FROM votes v JOIN polls p ON p.id = v.poll_id
       WHERE p.issue_id = $1 AND p.kind = 'stance'
       GROUP BY 1, 2
       ORDER BY 1`,
      [issueId],
    ),
    query<{ slug: string | null; choice: string; n: number }>(
      `SELECT v.voter_neighborhood_slug AS slug, v.choice, count(*)::int AS n
       FROM votes v JOIN polls p ON p.id = v.poll_id
       WHERE p.issue_id = $1 AND p.kind = 'stance'
       GROUP BY 1, 2`,
      [issueId],
    ),
    query<{ rating: number; n: number }>("SELECT rating, count(*)::int AS n FROM reviews WHERE issue_id = $1 GROUP BY rating", [issueId]),
    memberId
      ? query<{ poll_id: string; choice: string }>(
          "SELECT v.poll_id, v.choice FROM votes v JOIN polls p ON p.id = v.poll_id WHERE p.issue_id = $1 AND v.member_id = $2",
          [issueId, memberId],
        )
      : Promise.resolve({ rows: [] as { poll_id: string; choice: string }[] }),
    neighborhoodNames(),
    memberId ? memberGroups(query, memberId) : Promise.resolve([] as MemberGroup[]),
  ]);

  const mine = new Map(myVotes.rows.map((v) => [v.poll_id, v.choice]));
  const counts = new Map<string, Map<string, number>>();
  let sampleVotes = 0;
  for (const t of tallies.rows) {
    const perPoll = counts.get(t.poll_id) ?? new Map<string, number>();
    perPoll.set(t.choice, t.n);
    counts.set(t.poll_id, perPoll);
    sampleVotes += t.sample_n;
  }

  const pollViews: PollView[] = polls.rows.map((p) => {
    const c = counts.get(p.id) ?? new Map<string, number>();
    const options = p.options.map((o) => ({ id: o.id, label: o.label, votes: c.get(o.id) ?? 0 }));
    const passes = p.kind === "stance" ? c.get("pass") ?? 0 : 0;
    return {
      id: p.id,
      question: p.question,
      kind: p.kind,
      options,
      passes,
      total: options.reduce((s, o) => s + o.votes, 0) + passes,
      myChoice: mine.get(p.id) ?? null,
    };
  });
  const stance = pollViews.find((p) => p.kind === "stance") ?? null;
  const hasVoted = Boolean(stance?.myChoice);

  const trend: TrendPoint[] = [];
  const running = { support: 0, oppose: 0, pass: 0 };
  for (const row of trendRows.rows) {
    const key = row.choice === "support" || row.choice === "oppose" ? row.choice : "pass";
    running[key] += row.n;
    const last = trend.at(-1);
    if (last && last.day === row.day) Object.assign(last, running);
    else trend.push({ day: row.day, ...running });
  }

  const shares = new Map<string, NeighborhoodShare>();
  for (const row of hoodRows.rows) {
    const slug = row.slug ?? "unknown";
    const share = shares.get(slug) ?? { slug, name: row.slug ? names.get(row.slug) ?? row.slug : "Other", support: 0, oppose: 0, pass: 0 };
    const key = row.choice === "support" || row.choice === "oppose" ? row.choice : "pass";
    share[key] += row.n;
    shares.set(slug, share);
  }
  const byNeighborhood = [...shares.values()].sort(
    (a, b) => b.support + b.oppose + b.pass - (a.support + a.oppose + a.pass),
  );

  const distribution = [1, 2, 3, 4, 5].map((r) => ratingRows.rows.find((x) => x.rating === r)?.n ?? 0);
  const reviewCount = distribution.reduce((s, n) => s + n, 0);

  let reviews: IssueDetail["reviews"] = null;
  if (hasVoted && memberId) {
    const { rows } = await query<{
      id: string;
      rating: number;
      body: string;
      created_at: Date;
      member_id: string;
      name: string;
      is_sample: boolean;
      slug: string | null;
    }>(
      `SELECT r.id, r.rating, r.body, r.created_at, r.member_id, m.name, m.is_sample, v.voter_neighborhood_slug AS slug
       FROM reviews r
       JOIN members m ON m.id = r.member_id
       LEFT JOIN votes v ON v.poll_id = r.stance_poll_id AND v.member_id = r.member_id
       WHERE r.issue_id = $1
       ORDER BY r.created_at DESC
       LIMIT 60`,
      [issueId],
    );
    const items = rows.map((r) => ({
      id: r.id,
      author: shortName(r.name),
      neighborhood: r.slug ? names.get(r.slug) ?? null : null,
      rating: r.rating,
      body: r.body,
      createdAt: new Date(r.created_at).toISOString(),
      mine: r.member_id === memberId,
      sample: r.is_sample,
    }));
    const own = items.find((r) => r.mine);
    reviews = {
      average: reviewCount ? distribution.reduce((s, n, i) => s + n * (i + 1), 0) / reviewCount : null,
      distribution,
      items,
      mine: own ? { rating: own.rating, body: own.body } : null,
    };
  }

  const votingGroup = eligibleGroup(groups, issue);
  const closed = isClosed(issue.status, issue.deadline);

  return {
    id: issue.id,
    ref: issue.ref,
    title: issue.title,
    body: issue.body,
    topic: issue.topic,
    status: issue.status,
    meetingAt: iso(issue.meeting_at),
    deadline: iso(issue.deadline),
    deadlineKind: issue.deadline_kind,
    citation: issue.citation,
    sourceUrl: issue.source_url,
    surfacedAt: iso(issue.surfaced_at) ?? new Date().toISOString(),
    location: issue.location,
    affectedRadiusM: issue.affected_radius_m,
    group: issue.group_slug && issue.group_name ? { slug: issue.group_slug, name: issue.group_name } : null,
    neighborhoods: issue.neighborhood_slugs.map((slug) => ({ slug, name: names.get(slug) ?? slug })),
    analysis: issue.summary
      ? {
          summary: issue.summary,
          pros: issue.pros ?? [],
          cons: issue.cons ?? [],
          facts: issue.facts ?? [],
          model: issue.model,
          generatedAt: iso(issue.generated_at),
        }
      : null,
    polls: pollViews,
    trend,
    byNeighborhood,
    reviewCount,
    reviews,
    viewer: {
      signedIn: Boolean(memberId),
      canVote: Boolean(votingGroup) && !closed,
      closed,
      hasVoted,
      votingAs: votingGroup?.name ?? null,
    },
    sample: { issue: issue.is_sample, analysis: Boolean(issue.analysis_sample), activity: sampleVotes > 0 },
    live: true,
  };
}

export async function castVote(memberId: string, issueId: string, pollId: string, choice: string): Promise<void> {
  await db().transaction(async (client) => {
    const { rows } = await client.query<{
      kind: "stance" | "choice";
      options: { id: string }[];
      group_slug: string | null;
      neighborhood_slugs: string[];
      status: string;
      deadline: Date | null;
    }>(
      `SELECT p.kind, p.options, i.group_slug, i.neighborhood_slugs, i.status, i.deadline
       FROM polls p JOIN issues i ON i.id = p.issue_id
       WHERE p.id = $1 AND p.issue_id = $2 AND i.status IN ${PUBLIC_STATUSES}`,
      [pollId, issueId],
    );
    const poll = rows[0];
    if (!poll) throw new IssueActionError("not_found");
    if (isClosed(poll.status, poll.deadline)) throw new IssueActionError("closed");
    const valid = choice === "pass" ? poll.kind === "stance" : poll.options.some((o) => o.id === choice);
    if (!valid) throw new IssueActionError("invalid_choice");

    const groups = await memberGroups((sql, params) => client.query<MemberGroup>(sql, params), memberId);
    const group = eligibleGroup(groups, poll);
    if (!group) throw new IssueActionError("not_member");

    await client.query(
      `INSERT INTO votes (poll_id, member_id, choice, voter_neighborhood_slug)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (poll_id, member_id) DO UPDATE SET
         choice = EXCLUDED.choice, voter_neighborhood_slug = EXCLUDED.voter_neighborhood_slug, updated_at = now()`,
      [pollId, memberId, choice, group.neighborhood_slug],
    );
  });
}

export async function postReview(memberId: string, issueId: string, rating: number, body: string): Promise<void> {
  const text = body.trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 10 || text.length > 2000) {
    throw new IssueActionError("invalid_review");
  }
  try {
    await db().transaction(async (client) => {
      const { rows } = await client.query<{ id: string; status: string; deadline: Date | null }>(
        `SELECT p.id, i.status, i.deadline FROM polls p JOIN issues i ON i.id = p.issue_id
         WHERE p.issue_id = $1 AND p.kind = 'stance' AND i.status IN ${PUBLIC_STATUSES}`,
        [issueId],
      );
      const stance = rows[0];
      if (!stance) throw new IssueActionError("not_found");
      await client.query(
        `INSERT INTO reviews (issue_id, member_id, stance_poll_id, rating, body)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (issue_id, member_id) DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body, updated_at = now()`,
        [issueId, memberId, stance.id, rating, text],
      );
    });
  } catch (error) {
    // The composite foreign key to votes rejects a review without a vote or pass.
    if ((error as { code?: string }).code === "23503") throw new IssueActionError("vote_first");
    throw error;
  }
}
