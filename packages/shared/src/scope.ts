import { z } from "zod"

/**
 * A memory's visibility scope. This is the core product concept: the user picks
 * one of these for every fact an agent proposes, and retrieval is filtered by it
 * in the query layer — never by asking a model to behave.
 *
 * - `session`   only inside the conversation it was learned in
 * - `project`   inside one named project/workspace
 * - `global`    everywhere
 * - `suppressed` a tombstone. Never retrieved, never re-proposed.
 */
export const MEMORY_SCOPES = ["session", "project", "global", "suppressed"] as const
export const memoryScopeSchema = z.enum(MEMORY_SCOPES)
export type MemoryScope = z.infer<typeof memoryScopeSchema>

/** Scopes a user may actually choose in a consent prompt. `suppressed` is reached by declining. */
export const SELECTABLE_SCOPES = ["session", "project", "global"] as const
export const selectableScopeSchema = z.enum(SELECTABLE_SCOPES)
export type SelectableScope = z.infer<typeof selectableScopeSchema>

export const MEMORY_STATUSES = ["active", "superseded", "suppressed", "expired"] as const
export const memoryStatusSchema = z.enum(MEMORY_STATUSES)
export type MemoryStatus = z.infer<typeof memoryStatusSchema>

export const MEMORY_CATEGORIES = [
  "preference",
  "identity",
  "project",
  "relationship",
  "constraint",
  "fact",
] as const
export const memoryCategorySchema = z.enum(MEMORY_CATEGORIES)
export type MemoryCategory = z.infer<typeof memoryCategorySchema>

/**
 * The single denormalised key that the scope predicate matches on.
 *
 * `(scope='global' OR (scope='project' AND project_id=X) OR (scope='session' AND context_id=Y))`
 * collapses losslessly to `scope_key IN ('global', 'proj:X', 'sess:Y')` because the three
 * branches are mutually exclusive by construction. That matters because Cloudflare Vectorize
 * has no `$or` operator — only an implicit AND across keys plus `$in` within one key.
 *
 * Keep the prefixes short: Vectorize truncates indexed string metadata to the first 64 bytes,
 * and `proj:` + a 36-char uuid is 41.
 */
export const GLOBAL_SCOPE_KEY = "global"

export function projectScopeKey(projectId: string): string {
  return `proj:${projectId}`
}

export function sessionScopeKey(contextId: string): string {
  return `sess:${contextId}`
}

/**
 * Build the set of scope keys visible to a caller.
 *
 * This is an ALLOW-list, deliberately. `suppressed` has no arm, so tombstoned memories are
 * unreachable by construction rather than by remembering to exclude them — and a fourth scope
 * added later stays invisible until someone adds an arm here. A `scope <> 'suppressed'`
 * predicate would fail open instead, which is how leaks happen.
 */
export function visibleScopeKeys(input: {
  projectId?: string | null
  contextId?: string | null
}): string[] {
  const keys = [GLOBAL_SCOPE_KEY]
  if (input.projectId) keys.push(projectScopeKey(input.projectId))
  if (input.contextId) keys.push(sessionScopeKey(input.contextId))
  return keys
}
