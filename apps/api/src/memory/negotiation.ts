import { and, desc, eq, gt, sql } from "drizzle-orm"

import type {
  PendingNegotiation,
  ProposeMemoryInput,
  ProposeResult,
  ResolveNegotiationInput,
  SelectableScope,
} from "@workspace/shared"

import type { RequestContext } from "../context"
import { memoryEvents, negotiationCooldowns, negotiations } from "../db/schema"
import { factFingerprint } from "../lib/hash"
import { ids } from "../lib/id"
import { COOLDOWN_AFTER_CANCEL, HOUR, NEGOTIATION_TTL, now } from "../lib/time"
import { resolveContainers } from "./containers"
import { findNearDuplicate } from "./retrieval"
import {
  commitMemory,
  findActiveByFingerprint,
  findTombstone,
  toMemory,
  tombstone,
} from "./store"

/** Proposals per client per hour. Generous for a person, tight enough to stop a runaway loop. */
const PROPOSAL_QUOTA_PER_HOUR = 40

/**
 * Phase one of the negotiation. An agent can reach exactly this far and no further.
 *
 * Nothing is written to `memories` here — only to `negotiations`, which is TTL-swept and
 * never retrievable. If proposing wrote a durable memory row then an agent *could* write,
 * and a prompt-injected one could spray unconsented facts that the user would have to
 * moderate after the fact. That is a different product from the one this is.
 */
export async function propose(
  ctx: RequestContext,
  input: ProposeMemoryInput
): Promise<ProposeResult> {
  const timestamp = now()
  const factFp = await factFingerprint(input.fact)

  // Guards run in cost order, cheapest first — but more importantly, all of them run
  // BEFORE a human is interrupted. Never ask someone a question they have already answered.

  const declined = await findTombstone(ctx.db, ctx.userId, factFp)
  if (declined) {
    return {
      status: "suppressed",
      message:
        "The user previously declined this fact, so it was not proposed again. Do not retry it.",
    }
  }

  const existing = await findActiveByFingerprint(ctx.db, ctx.userId, factFp)
  if (existing) {
    return {
      status: "already_known",
      memory: toMemory(existing),
      message: `Already saved with ${existing.scope} scope. No action taken.`,
    }
  }

  const cooldown = await ctx.db.query.negotiationCooldowns.findFirst({
    where: and(
      eq(negotiationCooldowns.userId, ctx.userId),
      eq(negotiationCooldowns.factFp, factFp),
      gt(negotiationCooldowns.until, timestamp)
    ),
  })
  if (cooldown) {
    return {
      status: "cooldown",
      until: cooldown.until,
      message:
        "The user dismissed this exact proposal recently, so it was not shown again. " +
        "If it genuinely matters, raise it in conversation instead of calling this tool.",
    }
  }

  const recentProposals = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(negotiations)
    .where(
      and(
        eq(negotiations.userId, ctx.userId),
        eq(negotiations.clientId, ctx.clientId),
        gt(negotiations.createdAt, timestamp - HOUR)
      )
    )
  if (Number(recentProposals[0]?.count ?? 0) >= PROPOSAL_QUOTA_PER_HOUR) {
    return {
      status: "quota_exceeded",
      message:
        "This client has proposed too many memories in the last hour. Try again later.",
    }
  }

  // Resolved once, here, and frozen into the negotiation row. Phase two never re-resolves
  // them, so a container cannot change between the question and the write.
  const containers = await resolveContainers(
    ctx.db,
    ctx.userId,
    { conversationId: input.conversationId, projectKey: input.projectKey },
    { create: true }
  )

  const nearDuplicate = await findNearDuplicate(ctx, input.fact, containers)

  // Only offer scopes that can actually be honoured. A user is never shown a choice the
  // server would then have to silently downgrade — "just for now" quietly becoming
  // "forever" is the one failure mode that violates consent invisibly.
  const options: SelectableScope[] = []
  if (containers.contextId) options.push("session")
  if (containers.projectId) options.push("project")
  options.push("global")

  const negotiationId = ids.negotiation()
  const expiresAt = timestamp + NEGOTIATION_TTL

  await ctx.db.batch([
    ctx.db.insert(negotiations).values({
      id: negotiationId,
      userId: ctx.userId,
      clientId: ctx.clientId,
      conversationId: input.conversationId ?? null,
      fact: input.fact,
      factFp,
      category: input.category,
      options: JSON.stringify(options),
      projectId: containers.projectId,
      contextId: containers.contextId,
      nearDupId: nearDuplicate?.id ?? null,
      confidence: input.confidence ?? null,
      status: "pending",
      outcome: null,
      createdAt: timestamp,
      expiresAt,
      resolvedAt: null,
    }),
    ctx.db.insert(memoryEvents).values({
      memoryId: null,
      userId: ctx.userId,
      actor: ctx.clientId,
      event: "proposed",
      fromValue: null,
      toValue: input.fact,
      at: timestamp,
    }),
  ])

  return {
    status: "input_required",
    negotiationId,
    fact: input.fact,
    category: input.category,
    prompt: buildPrompt(input.fact, nearDuplicate),
    options,
    nearDuplicate,
    expiresAt,
  }
}

/**
 * Phase two. Only ever reachable from a human-authenticated request — never exposed as an
 * agent tool. If an agent could call this it could approve its own proposals, and the
 * consent gate would be decoration.
 */
export async function resolve(
  ctx: RequestContext,
  negotiationId: string,
  input: ResolveNegotiationInput
): Promise<ProposeResult> {
  const timestamp = now()

  const negotiation = await ctx.db.query.negotiations.findFirst({
    where: and(
      eq(negotiations.id, negotiationId),
      eq(negotiations.userId, ctx.userId)
    ),
  })
  if (!negotiation) {
    return { status: "expired", message: "That proposal no longer exists." }
  }

  // Idempotency. A double-click, a retried request or a replayed token all land here and
  // get the original answer back rather than writing a second time.
  if (negotiation.status !== "pending") {
    return negotiation.outcome
      ? (JSON.parse(negotiation.outcome) as ProposeResult)
      : { status: "expired", message: "That proposal was already resolved." }
  }

  if (negotiation.expiresAt <= timestamp) {
    const outcome: ProposeResult = {
      status: "expired",
      message:
        "That proposal expired before it was answered. Propose it again if it still matters.",
    }
    await finalize(ctx, negotiationId, "expired", outcome, timestamp)
    return outcome
  }

  if (input.action === "decline") {
    // A decline is permanent on purpose. The user is not saying "not now", they are saying
    // "never" — so it becomes a tombstone that later proposals check before asking again.
    await tombstone(ctx, {
      fact: negotiation.fact,
      factFp: negotiation.factFp,
      category: negotiation.category as ProposeMemoryInput["category"],
      negotiationId,
      originClient: negotiation.clientId,
    })
    const outcome: ProposeResult = {
      status: "declined",
      message:
        "The user declined. This fact is now suppressed and will never be suggested again.",
    }
    await finalize(ctx, negotiationId, "declined", outcome, timestamp)
    return outcome
  }

  if (input.action === "cancel") {
    // Nothing is written, but a cooldown is. Without it the model re-proposes on the very
    // next turn and the user gets the same chip again — prose in a tool result will not
    // deter it, a row keyed on the fact will.
    const until = timestamp + COOLDOWN_AFTER_CANCEL
    const outcome: ProposeResult = {
      status: "cancelled",
      message:
        "The user dismissed this proposal. Nothing was saved. Do not ask again now.",
    }
    await ctx.db
      .insert(negotiationCooldowns)
      .values({
        userId: ctx.userId,
        factFp: negotiation.factFp,
        until,
        reason: "dismissed",
      })
      .onConflictDoUpdate({
        target: [negotiationCooldowns.userId, negotiationCooldowns.factFp],
        set: { until, reason: "dismissed" },
      })
    await finalize(ctx, negotiationId, "cancelled", outcome, timestamp)
    return outcome
  }

  // --- accept ---------------------------------------------------------------

  const options = JSON.parse(negotiation.options) as SelectableScope[]
  const scope = input.scope!

  // The user may only pick from what was offered. A client that "accepts" with `global`
  // when only `project` was on the table is escalating on the user's behalf.
  if (!options.includes(scope)) {
    return {
      status: "expired",
      message: `Scope "${scope}" was not offered for this proposal.`,
    }
  }

  // Re-run the guards inside the commit. The first pass was UX — don't ask a question
  // already answered. This pass is correctness: the user may have suppressed this exact
  // fact from the dashboard while the chip sat open.
  const declined = await findTombstone(ctx.db, ctx.userId, negotiation.factFp)
  if (declined) {
    const outcome: ProposeResult = {
      status: "suppressed",
      message:
        "The user suppressed this fact while the prompt was open. Nothing was saved.",
    }
    await finalize(ctx, negotiationId, "cancelled", outcome, timestamp)
    return outcome
  }

  const duplicate = await findActiveByFingerprint(
    ctx.db,
    ctx.userId,
    negotiation.factFp
  )
  if (duplicate) {
    const outcome: ProposeResult = {
      status: "already_known",
      memory: toMemory(duplicate),
      message: "That fact was already saved while this prompt was open.",
    }
    await finalize(ctx, negotiationId, "accepted", outcome, timestamp)
    return outcome
  }

  const memory = await commitMemory(ctx, {
    fact: negotiation.fact,
    factFp: negotiation.factFp,
    category: negotiation.category as ProposeMemoryInput["category"],
    scope,
    projectId: negotiation.projectId,
    contextId: negotiation.contextId,
    confidence: negotiation.confidence,
    negotiationId,
    supersedes: input.replacesExisting ? negotiation.nearDupId : null,
    // From the negotiation, not from `ctx`: this request is the human approving, so
    // `ctx.clientId` is `web` even when an MCP agent proposed the fact.
    originClient: negotiation.clientId,
  })

  const outcome: ProposeResult = { status: "committed", memory }
  await finalize(ctx, negotiationId, "accepted", outcome, timestamp)
  return outcome
}

async function finalize(
  ctx: RequestContext,
  negotiationId: string,
  status: "accepted" | "declined" | "cancelled" | "expired",
  outcome: ProposeResult,
  timestamp: number
): Promise<void> {
  await ctx.db
    .update(negotiations)
    .set({ status, outcome: JSON.stringify(outcome), resolvedAt: timestamp })
    .where(
      and(
        eq(negotiations.id, negotiationId),
        eq(negotiations.userId, ctx.userId)
      )
    )
}

function buildPrompt(
  fact: string,
  nearDuplicate: { fact: string } | null
): string {
  if (nearDuplicate) {
    return (
      `Save this, and how widely?\n\n"${fact}"\n\n` +
      `You already have something similar: "${nearDuplicate.fact}". ` +
      `Tick "replace" to supersede it instead of keeping both.`
    )
  }
  return `Save this, and how widely?\n\n"${fact}"`
}

/** The recorded outcome of a resolved negotiation, or null if it is still pending. */
export async function getOutcome(
  ctx: RequestContext,
  negotiationId: string
): Promise<ProposeResult | null> {
  const row = await ctx.db.query.negotiations.findFirst({
    where: and(
      eq(negotiations.id, negotiationId),
      eq(negotiations.userId, ctx.userId)
    ),
    columns: { outcome: true },
  })
  if (!row?.outcome) return null

  try {
    return JSON.parse(row.outcome) as ProposeResult
  } catch {
    return null
  }
}

export async function listPending(
  ctx: RequestContext
): Promise<PendingNegotiation[]> {
  const rows = await ctx.db
    .select()
    .from(negotiations)
    .where(
      and(
        eq(negotiations.userId, ctx.userId),
        eq(negotiations.status, "pending"),
        gt(negotiations.expiresAt, now())
      )
    )
    .orderBy(desc(negotiations.createdAt))
    .limit(50)

  return rows.map((row) => ({
    id: row.id,
    fact: row.fact,
    category: row.category as PendingNegotiation["category"],
    options: JSON.parse(row.options) as SelectableScope[],
    originClient: row.clientId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }))
}
