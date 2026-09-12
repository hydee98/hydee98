import { getPool, isDbEnabled } from "../db/pool.js";
import type { User } from "../types.js";

/**
 * User store - same Postgres/in-memory dual-mode pattern as
 * data/listings.ts and data/orders.ts. Keyed by wallet public key (base58)
 * rather than an internal id - there's no signup form, a wallet signing in
 * for the first time simply creates its row.
 */

const memoryStore = new Map<string, User>();

export async function getUser(publicKey: string): Promise<User | undefined> {
  if (isDbEnabled()) {
    const { rows } = await getPool().query<{ data: User }>(
      "SELECT data FROM users WHERE public_key = $1",
      [publicKey]
    );
    return rows[0]?.data;
  }
  return memoryStore.get(publicKey);
}

/** Creates the user on first sign-in, otherwise just bumps lastSeenAt. */
export async function touchUser(publicKey: string): Promise<User> {
  const existing = await getUser(publicKey);
  const now = new Date().toISOString();
  const user: User = existing
    ? { ...existing, lastSeenAt: now }
    : { publicKey, displayName: null, createdAt: now, lastSeenAt: now };

  if (isDbEnabled()) {
    await getPool().query(
      `INSERT INTO users (public_key, data, created_at) VALUES ($1, $2, $3)
       ON CONFLICT (public_key) DO UPDATE SET data = $2`,
      [publicKey, user, user.createdAt]
    );
  } else {
    memoryStore.set(publicKey, user);
  }
  return user;
}

export async function updateUser(publicKey: string, patch: Partial<User>): Promise<User | undefined> {
  const existing = await getUser(publicKey);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch };

  if (isDbEnabled()) {
    await getPool().query("UPDATE users SET data = $2 WHERE public_key = $1", [publicKey, updated]);
  } else {
    memoryStore.set(publicKey, updated);
  }
  return updated;
}
