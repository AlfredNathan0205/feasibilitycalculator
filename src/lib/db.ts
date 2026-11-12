import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * One shared connection pool per server process.
 *
 * Previously every page and route built its own `postgres()` pool on every
 * request and never closed it, which exhausts Postgres's connection limit
 * ("sorry, too many clients already") under any real load — and managed
 * Postgres (Supabase, Azure Database for PostgreSQL) has hard connection
 * caps far below what a busy day of requests would open. The pool is cached
 * on globalThis so Next's dev-mode module reloads don't leak a new one each
 * time either.
 *
 * prepare: false because Supabase's pooler (port 6543) runs in transaction
 * mode, where named prepared statements are not supported and pipelined
 * extended-protocol messages can be rejected ("invalid message format").
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
  globalForDb.__cplDb = drizzle(postgres(databaseUrl, { max, prepare: false }), {
    schema,
  });
  return globalForDb.__cplDb;
}
