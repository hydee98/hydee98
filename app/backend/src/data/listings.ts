import { getPool, isDbEnabled } from "../db/pool.js";
import type { Listing } from "../types.js";
import { seedListings } from "./seedData.js";

/**
 * Listing store - Postgres-backed when DATABASE_URL is set, otherwise an
 * in-memory Map seeded from seedData.ts. Every function is async so routes
 * don't need to change when you switch backends. A real deployment would
 * eventually read the canonical listing list from the on-chain `Listing`
 * accounts (see solanaService.ts) and keep this only as an off-chain
 * metadata cache (full description, photos) keyed by the same id.
 */

const memoryStore = new Map<string, Listing>(seedListings.map((l) => [l.id, l]));

export async function listListings(): Promise<Listing[]> {
  if (isDbEnabled()) {
    const { rows } = await getPool().query<{ data: Listing }>(
      "SELECT data FROM listings ORDER BY created_at"
    );
    return rows.map((r) => r.data);
  }
  return Array.from(memoryStore.values());
}

export async function getListing(id: string): Promise<Listing | undefined> {
  if (isDbEnabled()) {
    const { rows } = await getPool().query<{ data: Listing }>(
      "SELECT data FROM listings WHERE id = $1",
      [id]
    );
    return rows[0]?.data;
  }
  return memoryStore.get(id);
}

export async function createListing(
  input: Omit<
    Listing,
    "id" | "createdAt" | "status" | "aiFraudScore" | "aiFraudFlags" | "onChainListingId" | "seller"
  >
): Promise<Listing> {
  const id = `listing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const listing: Listing = {
    ...input,
    id,
    onChainListingId: null,
    seller: null,
    status: "PendingReview",
    aiFraudScore: null,
    aiFraudFlags: [],
    createdAt: new Date().toISOString(),
  };

  if (isDbEnabled()) {
    await getPool().query(
      "INSERT INTO listings (id, data, created_at) VALUES ($1, $2, $3)",
      [id, listing, listing.createdAt]
    );
  } else {
    memoryStore.set(id, listing);
  }
  return listing;
}

export async function updateListing(
  id: string,
  patch: Partial<Listing>
): Promise<Listing | undefined> {
  const existing = await getListing(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch };

  if (isDbEnabled()) {
    await getPool().query("UPDATE listings SET data = $2 WHERE id = $1", [id, updated]);
  } else {
    memoryStore.set(id, updated);
  }
  return updated;
}
