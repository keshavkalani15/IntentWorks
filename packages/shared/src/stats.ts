import { z } from "zod"

import { memoryEventSchema } from "./memory"
import { memoryScopeSchema } from "./scope"

export const activityEntrySchema = z.object({
  id: z.number(),
  event: memoryEventSchema,
  actor: z.string(),
  at: z.number(),
  memoryId: z.string().nullable(),
  /** The fact this event concerned. Falls back to the event payload for declines, which
   *  never produce a retrievable memory row. */
  fact: z.string().nullable(),
  scope: memoryScopeSchema.nullable(),
})
export type ActivityEntry = z.infer<typeof activityEntrySchema>

export const statsSchema = z.object({
  memories: z.object({
    active: z.number(),
    suppressed: z.number(),
    superseded: z.number(),
    byScope: z.record(z.string(), z.number()),
    byCategory: z.record(z.string(), z.number()),
    firstAt: z.number().nullable(),
    latestAt: z.number().nullable(),
  }),
  proposals: z.object({
    total: z.number(),
    accepted: z.number(),
    declined: z.number(),
    cancelled: z.number(),
    pending: z.number(),
    /** Share of answered proposals that were accepted. Null until one is answered. */
    acceptanceRate: z.number().nullable(),
  }),
  conversations: z.number(),
  /** One bucket per day, oldest first, covering the trailing window. */
  activityByDay: z.array(z.object({ day: z.number(), added: z.number() })),
  recent: z.array(activityEntrySchema),
})
export type Stats = z.infer<typeof statsSchema>
