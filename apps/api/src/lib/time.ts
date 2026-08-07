export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** How long a user has to answer a consent prompt before it lapses. */
export const NEGOTIATION_TTL = 15 * MINUTE

/**
 * How long a dismissed proposal stays un-re-askable.
 *
 * This is the only thing that reliably stops the cancel loop — a model that just had a
 * proposal dismissed will otherwise call the tool again on the very next turn, and prose
 * in the tool result does not deter it.
 */
export const COOLDOWN_AFTER_CANCEL = 10 * MINUTE

/** A session context lapses after this much inactivity; its memories are then swept. */
export const CONTEXT_IDLE_TTL = 24 * HOUR

/**
 * Single source of "now" for a request.
 *
 * Held once and reused so that D1 and Vectorize can never disagree about whether a
 * memory had expired at the moment it was read.
 */
export function now(): number {
  return Date.now()
}
