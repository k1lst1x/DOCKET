import type { PendingJoin, Session } from "./auth";
import type { VerifiedIdentity } from "./cognito";
import { db } from "./db";
import type { Role } from "./types";

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

    if (join) {
      await client.query(
        `INSERT INTO memberships (member_id, group_slug, topics, other_topic, can_speak_evenings)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (member_id, group_slug) DO UPDATE SET
           topics = EXCLUDED.topics, other_topic = EXCLUDED.other_topic, can_speak_evenings = EXCLUDED.can_speak_evenings`,
        [identity.sub, join.slug, JSON.stringify(join.topics), join.otherTopic, join.canSpeakEvenings],
      );
    }

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
