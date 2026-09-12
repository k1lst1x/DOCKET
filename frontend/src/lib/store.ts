import { randomUUID } from "node:crypto";
import type { Role } from "./types";

// In-memory member store. It resets on every server restart and is not shared
// between Amplify compute instances; replace with the database before launch.

export interface Membership {
  groupId: string;
  slug: string;
  role: Role;
  topics: string[];
  otherTopic: string | null;
  canSpeakEvenings: boolean;
  joinedAt: string;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  verifiedAt: string | null;
  memberships: Membership[];
}

interface Store {
  members: Map<string, Member>;
  usedMagicNonces: Set<string>;
}

const globalStore = globalThis as typeof globalThis & { __docketStore?: Store };
const store: Store = (globalStore.__docketStore ??= { members: new Map(), usedMagicNonces: new Set() });

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function findMemberByEmail(email: string): Member | undefined {
  const target = normalizeEmail(email);
  for (const member of store.members.values()) if (member.email === target) return member;
  return undefined;
}

export const getMember = (id: string) => store.members.get(id);

export interface JoinInput {
  name: string;
  email: string;
  groupId: string;
  slug: string;
  topics: string[];
  otherTopic: string | null;
  canSpeakEvenings: boolean;
}

/**
 * Idempotent per email and group. The join form is unauthenticated, so it never
 * changes a verified member's details; they get a fresh sign-in link instead.
 */
export function upsertMembership(input: JoinInput): { member: Member; created: boolean } {
  const now = new Date().toISOString();
  let member = findMemberByEmail(input.email);
  const isNewMember = !member;
  if (member?.verifiedAt) return { member, created: false };
  if (!member) {
    member = { id: randomUUID(), name: input.name, email: normalizeEmail(input.email), createdAt: now, verifiedAt: null, memberships: [] };
    store.members.set(member.id, member);
  }
  const existing = member.memberships.find((m) => m.groupId === input.groupId);
  const preferences = { topics: input.topics, otherTopic: input.otherTopic, canSpeakEvenings: input.canSpeakEvenings };
  if (existing) Object.assign(existing, preferences);
  else member.memberships.push({ groupId: input.groupId, slug: input.slug, role: "member", joinedAt: now, ...preferences });
  return { member, created: isNewMember || !existing };
}

/** Returns false if the nonce was already spent, so each magic link works once. */
export function spendMagicNonce(nonce: string): boolean {
  if (store.usedMagicNonces.has(nonce)) return false;
  store.usedMagicNonces.add(nonce);
  return true;
}

export function markVerified(member: Member): void {
  member.verifiedAt ??= new Date().toISOString();
}
