import { z } from "zod"

import {
  memoryCategorySchema,
  memoryScopeSchema,
  memoryStatusSchema,
  selectableScopeSchema,
} from "./scope"

/** Timestamps are unix milliseconds everywhere. SQLite has no date type and D1 does not
 *  publish its SQLite version, so `unixepoch()` is unsafe to assume — we bind `Date.now()`. */
export const NEVER_EXPIRES = 4102444800000 // 2100-01-01, the "no expiry" sentinel

export const memorySchema = z.object({
  id: z.string(),
  fact: z.string(),
  category: memoryCategorySchema.nullable(),
  scope: memoryScopeSchema,
  projectId: z.string().nullable(),
  contextId: z.string().nullable(),
  status: memoryStatusSchema,
  confidence: z.number().nullable(),
  originClient: z.string(),
  supersededBy: z.string().nullable(),
  createdAt: z.number(),
  lastConfirmed: z.number().nullable(),
  expiresAt: z.number(),
})
export type Memory = z.infer<typeof memorySchema>

/** A memory returned from retrieval, carrying why it matched. */
export const retrievedMemorySchema = memorySchema.extend({
  score: z.number(),
  matchedBy: z.array(z.enum(["keyword", "semantic", "recent"])),
})
export type RetrievedMemory = z.infer<typeof retrievedMemorySchema>

export const MEMORY_EVENTS = [
  "proposed",
  "accepted",
  "declined",
  "cancelled",
  "rescoped",
  "suppressed",
  "superseded",
  "confirmed",
  "expired",
  "restored",
] as const
export const memoryEventSchema = z.enum(MEMORY_EVENTS)
export type MemoryEventKind = z.infer<typeof memoryEventSchema>

export const timelineEntrySchema = z.object({
  id: z.number(),
  memoryId: z.string().nullable(),
  actor: z.string(),
  event: memoryEventSchema,
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  at: z.number(),
})
export type TimelineEntry = z.infer<typeof timelineEntrySchema>

export const projectSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string().nullable(),
  memoryCount: z.number().optional(),
})
export type Project = z.infer<typeof projectSchema>

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

export const searchMemoryInput = z.object({
  query: z.string().min(1).max(1000),
  conversationId: z.string().optional(),
  projectKey: z.string().max(200).optional(),
  categories: z.array(memoryCategorySchema).optional(),
  limit: z.number().int().min(1).max(50).default(10),
})

export const proposeMemoryInput = z.object({
  fact: z.string().min(3).max(2000),
  category: memoryCategorySchema.default("fact"),
  suggestedScope: selectableScopeSchema.optional(),
  conversationId: z.string().optional(),
  projectKey: z.string().max(200).optional(),
  confidence: z.number().min(0).max(1).optional(),
})
export type ProposeMemoryInput = z.infer<typeof proposeMemoryInput>

export const rescopeMemoryInput = z.object({ scope: selectableScopeSchema })

export const bulkMemoryInput = z.object({
  ids: z.array(z.string()).min(1).max(200),
  action: z.enum(["rescope", "suppress", "delete"]),
  scope: selectableScopeSchema.optional(),
})

export const listMemoriesQuery = z.object({
  scope: memoryScopeSchema.optional(),
  status: memoryStatusSchema.optional().default("active"),
  category: memoryCategorySchema.optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
