import { Hono } from "hono"

import { resolveNegotiationInput } from "@workspace/shared"

import type { AppBindings } from "../env"
import { badRequest } from "../lib/errors"
import { listPending, resolve } from "../memory/negotiation"
import { contextFrom, requireUser } from "../middleware/auth"

/**
 * Phase two of the negotiation, and the load-bearing boundary of the whole product:
 * `resolve` lives ONLY here, behind `requireUser`. It is deliberately absent from the
 * agent's tool surface — an agent that could resolve its own proposals would make the
 * consent gate decoration.
 */
export const negotiationsRoute = new Hono<AppBindings>()

negotiationsRoute.use("*", requireUser)

negotiationsRoute.get("/", async (c) => {
  return c.json({ items: await listPending(contextFrom(c)) })
})

negotiationsRoute.post("/:id/resolve", async (c) => {
  const parsed = resolveNegotiationInput.safeParse(await c.req.json())
  if (!parsed.success) {
    throw badRequest("invalid_body", "Invalid decision.", parsed.error.issues)
  }

  const result = await resolve(contextFrom(c), c.req.param("id"), parsed.data)
  return c.json({ result })
})
