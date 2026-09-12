import { getPool, isDbEnabled } from "./pool.js";
import { seedListings, seedOrders } from "../data/seedData.js";

/**
 * Idempotent schema setup + first-boot seeding. Called once at server
 * startup (see index.ts) - safe to run on every deploy: CREATE TABLE IF
 * NOT EXISTS is a no-op once the tables exist, and seeding only happens
 * when a table is completely empty (so it never overwrites real data).
 *
 * Each row stores its record as a single JSONB blob (`data`) rather than a
 * column per field - the app's TypeScript types stay the single source of
 * truth for shape, and this demo has no need for relational joins/queries
 * beyond "all rows" / "by id" / "by listing_id".
 */
export async function ensureSchema(): Promise<void> {
  if (!isDbEnabled()) return;
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      public_key TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { rows: listingCount } = await pool.query("SELECT count(*)::int AS n FROM listings");
  if (listingCount[0].n === 0) {
    for (const listing of seedListings) {
      await pool.query("INSERT INTO listings (id, data, created_at) VALUES ($1, $2, $3)", [
        listing.id,
        listing,
        listing.createdAt,
      ]);
    }
    console.log(`Seeded ${seedListings.length} demo listings into the database.`);
  }

  const { rows: orderCount } = await pool.query("SELECT count(*)::int AS n FROM orders");
  if (orderCount[0].n === 0) {
    for (const order of seedOrders) {
      await pool.query(
        "INSERT INTO orders (id, listing_id, data, created_at) VALUES ($1, $2, $3, $4)",
        [order.id, order.listingId, order, order.createdAt]
      );
    }
    console.log(`Seeded ${seedOrders.length} demo orders into the database.`);
  }
}
