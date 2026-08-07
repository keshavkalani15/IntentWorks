import { drizzle } from "drizzle-orm/d1"

import { schema } from "./schema"

export function createDb(d1: D1Database) {
  // Every column carries an explicit snake_case name in schema.ts, so no casing strategy.
  return drizzle(d1, { schema })
}

export type Db = ReturnType<typeof createDb>
