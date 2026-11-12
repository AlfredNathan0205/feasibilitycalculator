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
 * Pool size: DB_POOL_MAX (default 3). Keep it small on serverless, where
 * every warm instance holds its own pool.
 */
const globalForDb = globalThis as unknown as { __cplDb?: Db };

type Sql = ReturnType<typeof postgres>;

const READ_TIMEOUT_MS =
  Number.parseInt(process.env.DB_READ_TIMEOUT_MS ?? "8000", 10) || 8000;
const WRITE_TIMEOUT_MS = 30_000;
const READ_ATTEMPTS = 3;
const RETRYABLE_CODES = new Set([
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "CONNECTION_CLOSED",
  "CONNECT_TIMEOUT",
]);

class QueryStalled extends Error {
  constructor(ms: number) {
    super(`Database query got no response in ${ms} ms`);
    this.name = "QueryStalled";
  }
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new QueryStalled(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Supabase's pooler listens on 6543 (transaction mode) and 5432 (session
 * mode). Transaction mode, which multiplexes many clients over few backend
 * connections, was silently losing query replies for this app; session mode
 * gives each connection its own backend. Set DB_POOLER_MODE=transaction to go
 * back to the URL's own port.
 */
export function resolveDatabaseUrl(databaseUrl: string): string {
  if (process.env.DB_POOLER_MODE === "transaction") return databaseUrl;
  try {
    const url = new URL(databaseUrl);
    if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543") {
      url.port = "5432";
      return url.toString();
    }
  } catch {
    /* not a URL we understand: use it as given */
  }
  return databaseUrl;
}

function createClient(databaseUrl: string): Sql {
  const max = Number.parseInt(process.env.DB_POOL_MAX ?? "3", 10) || 3;
  // max_pipeline is a real postgres.js option but missing from its typings.
  const options = {
    max,
    prepare: false,
    max_pipeline: 1,
    idle_timeout: 5,
    max_lifetime: 120,
    connect_timeout: 10,
  } as postgres.Options<Record<string, postgres.PostgresType>>;
  return postgres(resolveDatabaseUrl(databaseUrl), options);
}

/**
 * Wraps the pool so a query whose response never arrives cannot hang a
 * request. Production showed individual queries through the Supabase pooler
 * silently losing their reply, leaving the request waiting for the platform's
 * 300 s timeout. Here, a read (SELECT / WITH) that gets no reply within
 * READ_TIMEOUT_MS is retried on a fresh pool, up to READ_ATTEMPTS times. A
 * write is never retried (it may have executed), it just fails after
 * WRITE_TIMEOUT_MS. The stuck pool is closed so its dead sockets are dropped.
 */
function createGuardedClient(databaseUrl: string): Sql {
  let active = createClient(databaseUrl);

  const replace = (stuck: Sql) => {
    if (active !== stuck) return; // someone else already replaced it
    active = createClient(databaseUrl);
    void stuck.end({ timeout: 0 }).catch(() => {});
  };

  const guardedUnsafe = (query: string, params?: unknown[], opts?: object) => {
    const isRead = /^\s*(select|with|explain|show)\b/i.test(query);
    const attempts = isRead ? READ_ATTEMPTS : 1;
    const timeout = isRead ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;

    const exec = async (asValues: boolean) => {
      for (let attempt = 1; ; attempt++) {
        const client = active;
        const pending = client.unsafe(query, params as never, opts as never);
        try {
          return await withTimeout(asValues ? pending.values() : pending, timeout);
        } catch (e) {
          const code = (e as { code?: string }).code;
          const stalled = e instanceof QueryStalled;
          if (stalled) {
            try {
              pending.cancel();
            } catch {
              /* already finished or not cancellable */
            }
            console.error(
              `[db] no reply after ${timeout} ms (attempt ${attempt}/${attempts}): ${query
                .trim()
                .slice(0, 60)
                .replace(/\s+/g, " ")}`,
            );
            replace(client);
          }
          const retryable = stalled || (code !== undefined && RETRYABLE_CODES.has(code));
          if (!isRead || !retryable || attempt >= attempts) throw e;
        }
      }
    };

    return {
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        exec(false).then(res, rej),
      values: () => ({
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          exec(true).then(res, rej),
      }),
    };
  };

  return new Proxy(function () {} as unknown as Sql, {
    get: (_t, prop) => {
      if (prop === "unsafe") return guardedUnsafe;
      const value = (active as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? value.bind(active) : value;
    },
    apply: (_t, _this, args) =>
      (active as unknown as (...a: unknown[]) => unknown)(...args),
  });
}

export function getDb(): Db {
  if (globalForDb.__cplDb) return globalForDb.__cplDb;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  globalForDb.__cplDb = drizzle(createGuardedClient(databaseUrl), { schema });
  return globalForDb.__cplDb;
}
