import { randomUUID } from "node:crypto";
import type { PendingJoin, Session } from "./auth";
import { db } from "./db";
import { dummyHash, hashPassword, verifyPassword } from "./passwords";
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

export type AccountResult =
  | { ok: true; session: Session; created: boolean }
  | { ok: false; error: "email_taken" | "wrong_password" };

/**
 * Creates an account (and, from a join form, its first membership) and returns its session. Email must already be
 * lowercased. No email is sent. A member from the emailed-code days has no password yet, so registering with that
 * email sets one. Safe to retry, which the pool's transaction helper does on optimistic-concurrency conflicts.
 */
export async function registerMember(name: string, email: string, password: string, join: PendingJoin | null): Promise<AccountResult> {
  const passwordHash = await hashPassword(password);
  try {
    return await db().transaction(async (client): Promise<AccountResult> => {
      const { rows: existing } = await client.query<{ id: string; password_hash: string | null; is_sample: boolean }>(
        "SELECT id, password_hash, is_sample FROM members WHERE email = $1",
        [email],
      );
      const current = existing[0];
      if (current && (current.password_hash || current.is_sample)) return { ok: false, error: "email_taken" };

      const memberId = current?.id ?? randomUUID();
      if (current) {
        await client.query("UPDATE members SET name = $2, password_hash = $3 WHERE id = $1", [memberId, name, passwordHash]);
      } else {
        await client.query("INSERT INTO members (id, name, email, password_hash) VALUES ($1, $2, $3, $4)", [memberId, name, email, passwordHash]);
      }
      if (join) await client.query(UPSERT_MEMBERSHIP, membershipParams(memberId, join));

      const { rows } = await client.query<{ group_slug: string; role: Role }>(
        "SELECT group_slug, role FROM memberships WHERE member_id = $1 ORDER BY joined_at",
        [memberId],
      );
      return {
        ok: true,
        created: !current,
        session: { memberId, name, email, groups: rows.map((r) => ({ slug: r.group_slug, role: r.role })) },
      };
    });
  } catch (error) {
    // Two registrations for the same email at once: the unique email constraint rejects the second.
    if ((error as { code?: string } | null)?.code === "23505") return { ok: false, error: "email_taken" };
    throw error;
  }
}

/** Checks an email and password (email already lowercased) and returns the session, joining a group first if asked. */
export async function loginMember(email: string, password: string, join: PendingJoin | null): Promise<AccountResult> {
  const { rows } = await db().query<{ id: string; name: string; password_hash: string | null }>(
    "SELECT id, name, password_hash FROM members WHERE email = $1",
    [email],
  );
  const member = rows[0];
  // Always run a hash check, so the response time doesn't reveal which emails have accounts.
  const matches = await verifyPassword(password, member?.password_hash ?? (await dummyHash()));
  if (!member?.password_hash || !matches) return { ok: false, error: "wrong_password" };

  if (join) await joinGroup(member.id, join);
  return {
    ok: true,
    created: false,
    session: { memberId: member.id, name: member.name, email, groups: await listMemberships(member.id) },
  };
}

/** A signed-in member joins another group without re-entering their details. */
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
