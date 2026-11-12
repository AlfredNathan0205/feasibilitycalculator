import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * One shared connection pool per server process, cached on globalThis so
 * Next's dev-mode module reloads and warm serverless instances reuse it
 * instead of opening a new pool per request (managed Postgres has hard
 * connection caps).
 *
 * Supabase's pooler (port 6543) runs in transaction mode. Two consequences,
 * both of which caused production page hangs and "invalid message format"
 * errors on the dashboard (which fires ~25 queries at once):
 *  - prepare: false, because named prepared statements are not supported;
 *  - max_pipeline: 1, because postgres.js otherwise pipelines many queries
 *    down one connection and the pooler mishandles that, leaving requests
 *    waiting until the platform's 300 s timeout.
 * Idle sockets are recycled quickly and connecting fails fast, so a frozen
 * serverless instance does not keep a dead connection.
 *
 * Pool size: DB_POOL_MAX (default 5). Keep it small on serverless, where
 * every warm instance holds its own pool.
 */
const globalForDb = globalThis as unknown as { __cplDb?: Db };

export function getDb(): Db {
  if (globalForDb.__cplDb) return globalForDb.__cplDb;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  const max = Number.parseInt(process.env.DB_POOL_MAX ?? "5", 10) || 5;
  // max_pipeline is a real postgres.js option but missing from its typings.
  const options = {
    max,
    prepare: false,
    max_pipeline: 1,
    idle_timeout: 5,
    max_lifetime: 120,
    connect_timeout: 10,
  } as postgres.Options<Record<string, postgres.PostgresType>>;
  globalForDb.__cplDb = drizzle(postgres(databaseUrl, options), { schema });
  return globalForDb.__cplDb;
}
