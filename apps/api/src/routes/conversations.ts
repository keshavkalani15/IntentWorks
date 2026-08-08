import { Hono } from "hono"

import type { AppBindings } from "../env"
import {
  deleteConversation,
  ensureConversation,
  getMessages,
  listConversations,
} from "../chat/conversations"
import { contextFrom, requireUser } from "../middleware/auth"

export const conversationsRoute = new Hono<AppBindings>()

conversationsRoute.use("*", requireUser)

conversationsRoute.get("/", async (c) => {
  return c.json({ items: await listConversations(contextFrom(c)) })
})

conversationsRoute.post("/", async (c) => {
  const id = await ensureConversation(contextFrom(c), undefined)
  return c.json({ id })
})

conversationsRoute.get("/:id/messages", async (c) => {
  const messages = await getMessages(contextFrom(c), c.req.param("id"))
  return c.json({ items: messages })
})

conversationsRoute.delete("/:id", async (c) => {
  await deleteConversation(contextFrom(c), c.req.param("id"))
  return c.json({ ok: true })
})
