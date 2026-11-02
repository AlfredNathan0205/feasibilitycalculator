// Applies drizzle/*.sql to DATABASE_URL using only runtime dependencies, so it
// can run inside the app image without dev tooling. Safe to re-run: applied
// migrations are tracked in drizzle.__drizzle_migrations (the same table
// `drizzle-kit migrate` uses, so the two are interchangeable).
//
// Usage: DATABASE_URL=postgresql://... node scripts/migrate.mjs
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}
const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: folder });
  console.log("Migrations applied.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await client.end();
}
