import { defineConfig } from "drizzle-kit"

/**
 * Generates SQL into `migrations/`, which `wrangler d1 migrations apply` then runs.
 * The FTS5 virtual table and its sync triggers cannot be expressed in Drizzle's schema
 * DSL, so they live in a hand-written migration alongside the generated ones.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
  verbose: true,
  strict: true,
})
