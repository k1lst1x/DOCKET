import type { PendingJoin, Session } from "./auth";
import type { VerifiedIdentity } from "./cognito";
import { db } from "./db";
import type { Role } from "./types";

const UPSERT_MEMBERSHIP = `INSERT INTO memberships (member_id, group_slug, topics, other_topic, can_speak_evenings)
  VALUES ($1, $2, $3::jsonb, $4, $5)
  ON CONFLICT (member_id, group_slug) DO UPDATE SET
    topics = EXCLUDED.topics, other_topic = EXCLUDED.other_topic, can_speak_evenings = EXCLUDED.can_speak_evenings`;

const membershipParams = (memberId: string, join: PendingJoin) => [
  memberId,
  join.slug,
  JSON.stringify(join.topics),
  join.otherTopic,
  join.canSpeakEvenings,
];

/**
 * Saves a verified sign-in to DSQL: the member row (keyed by Cognito sub) and,
 * when it came from a join form, the group membership. Safe to retry, which
 * the pool's transaction helper does on optimistic-concurrency conflicts.
 */
export async function recordSignIn(identity: VerifiedIdentity, requestedName: string | null, join: PendingJoin | null): Promise<Session> {
  const fallbackName = (requestedName ?? identity.name ?? identity.email.split("@")[0]).slice(0, 80) || "Neighbor";

  return db().transaction(async (client) => {
    await client.query(
      `INSERT INTO members (id, name, email, verified_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, verified_at = COALESCE(members.verified_at, EXCLUDED.verified_at)`,
      [identity.sub, fallbackName, identity.email],
    );

    if (join) await client.query(UPSERT_MEMBERSHIP, membershipParams(identity.sub, join));

    const { rows } = await client.query<{ name: string; group_slug: string | null; role: Role | null }>(
      `SELECT m.name, ms.group_slug, ms.role
       FROM members m LEFT JOIN memberships ms ON ms.member_id = m.id
       WHERE m.id = $1
       ORDER BY ms.joined_at`,
      [identity.sub],
    );

    return {
      memberId: identity.sub,
      name: rows[0]?.name ?? fallbackName,
      email: identity.email,
      groups: rows.flatMap((r) => (r.group_slug && r.role ? [{ slug: r.group_slug, role: r.role }] : [])),
    };
  });
}

/** A signed-in member joins another group without re-entering name, email or a code. */
export async function joinGroup(memberId: string, join: PendingJoin): Promise<void> {
  await db().transaction(async (client) => {
    await client.query(UPSERT_MEMBERSHIP, membershipParams(memberId, join));
  });
}

/** Current memberships from the database (the session cookie can be stale). */
export async function listMemberships(memberId: string): Promise<{ slug: string; role: Role }[]> {
  const { rows } = await db().query<{ group_slug: string; role: Role }>(
    "SELECT group_slug, role FROM memberships WHERE member_id = $1 ORDER BY joined_at",
    [memberId],
  );
  return rows.map((r) => ({ slug: r.group_slug, role: r.role }));
}
