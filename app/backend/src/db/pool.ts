import pg from "pg";

/**
 * Postgres connection pool - only created when DATABASE_URL is set. Every
 * data module (see ../data/*.ts) checks `isDbEnabled()` and falls back to
 * an in-memory Map when it's false, so local dev works with zero setup and
 * production (Render Postgres, or any DATABASE_URL) gets real persistence.
 */

let pool: pg.Pool | null = null;

export function isDbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): pg.Pool {
  if (!isDbEnabled()) {
    throw new Error("getPool() called without DATABASE_URL set");
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      // Render's managed Postgres requires SSL; local/dev Postgres
      // typically doesn't support it at all. Only request it when the
      // connection string doesn't already say otherwise (sslmode=disable
      // is how you'd opt out for a local DB while still using this pool).
      ssl:
        process.env.DATABASE_URL?.includes("sslmode=disable")
          ? undefined
          : { rejectUnauthorized: false },
    });
  }
  return pool;
}
