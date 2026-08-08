import { Hono } from "hono"

import type { AppBindings } from "../env"
import { getStats } from "../memory/stats"
import { contextFrom, requireUser } from "../middleware/auth"

export const statsRoute = new Hono<AppBindings>()

statsRoute.use("*", requireUser)

statsRoute.get("/", async (c) => c.json(await getStats(contextFrom(c))))
