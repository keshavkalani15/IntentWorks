import { Hono } from "hono"

import type { AppBindings } from "../env"
import { buildGraph } from "../memory/graph"
import { buildRelated } from "../memory/related"
import { contextFrom, requireUser } from "../middleware/auth"

export const graphRoute = new Hono<AppBindings>()

graphRoute.use("*", requireUser)

graphRoute.get("/", async (c) => c.json(await buildGraph(contextFrom(c))))

// Separate from `/` because it fans out to Vectorize and then compares every pair. Keeping the
// structural graph on its own route means the shells still render instantly when this is slow,
// and still render at all when the vector index is unbound.
graphRoute.get("/related", async (c) =>
  c.json(await buildRelated(contextFrom(c)))
)
