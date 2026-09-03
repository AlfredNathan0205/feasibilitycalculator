import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Placeholder for local/dev migration runs only. In deployment,
    // App Service resolves this via Key Vault + managed identity, never a
    // password in config (see /infra README, once built).
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/placeholder",
  },
} satisfies Config;
