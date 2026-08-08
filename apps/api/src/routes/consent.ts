import { and, eq } from "drizzle-orm"
import { Hono } from "hono"

import type { SelectableScope } from "@workspace/shared"

import { createAuth } from "../auth"
import { createDb } from "../db/client"
import { negotiations } from "../db/schema"
import type { AppBindings } from "../env"
import { esc, page, signInFirst } from "../lib/html"
import { now } from "../lib/time"

/**
 * `GET /consent/:negotiationId` — where a memory proposed over MCP is actually approved.
 *
 * This page is the reason the whole design holds. An MCP client is told to send its user
 * here; the user arrives in their own browser, is identified by the **session cookie** — a
 * credential the client provably does not hold and cannot forge — and the decision is posted
 * to the unchanged `POST /api/negotiations/:id/resolve`.
 *
 * That is what keeps the guarantee intact. The alternative, a form-mode elicitation, would
 * collect the answer through the agent's own connection on the agent's own token, where
 * "the human clicked Save" and "the client fabricated an approval" are indistinguishable.
 *
 * Read-only here. Nothing on this route writes; it renders a question and the existing
 * human-plane endpoint answers it.
 */
export const consentRoute = new Hono<AppBindings>()

const SCOPE_COPY: Record<SelectableScope, { label: string; detail: string }> = {
  session: {
    label: "Just this conversation",
    detail: "Forgotten when the conversation goes idle.",
  },
  project: {
    label: "This project only",
    detail: "Available whenever you are working in this project.",
  },
  global: {
    label: "Everywhere",
    detail: "Available in every conversation and project.",
  },
}

consentRoute.get("/:negotiationId", async (c) => {
  const origin = new URL(c.req.url).origin
  const auth = createAuth(c.env, origin)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })

  if (!session?.user) {
    return signInFirst(
      origin,
      "An application has suggested something to save to your memory."
    )
  }

  const negotiationId = c.req.param("negotiationId")

  /**
   * Scoped to the signed-in user in the query itself — this is the phishing defence, and it
   * is not optional.
   *
   * The attack the spec calls out: Alice triggers a proposal, does not click the link, and
   * instead gets Bob — a real user of this same server — to open it. Bob is signed in and
   * sees a Save button. Without this predicate his click would resolve *Alice's* negotiation
   * and write a fact she authored into a store she does not control.
   *
   * A mismatch is reported as "no longer available" rather than "not yours", because
   * distinguishing the two would confirm to an attacker that a given id exists.
   */
  const negotiation = await createDb(c.env.DB).query.negotiations.findFirst({
    where: and(
      eq(negotiations.id, negotiationId),
      eq(negotiations.userId, session.user.id)
    ),
  })

  if (!negotiation) return gone("That suggestion is no longer available.")

  if (negotiation.status !== "pending") {
    return settled(negotiation.status)
  }

  if (negotiation.expiresAt <= now()) {
    return gone(
      "That suggestion expired before it was answered. Nothing was saved — if it still " +
        "matters, ask again and a fresh one will be created."
    )
  }

  const options = JSON.parse(negotiation.options) as SelectableScope[]
  const nearDuplicate = negotiation.nearDupId
    ? await createDb(c.env.DB).query.memories.findFirst({
        where: (memories, { eq: is }) =>
          is(memories.id, negotiation.nearDupId!),
        columns: { fact: true },
      })
    : null

  const scopeInputs = options
    .map((scope, index) => {
      const copy = SCOPE_COPY[scope]
      return (
        `<label class="opt"><input type="radio" name="scope" value="${esc(scope)}"` +
        `${index === options.length - 1 ? " checked" : ""}>` +
        `<div><strong>${esc(copy.label)}</strong><span>${esc(copy.detail)}</span></div></label>`
      )
    })
    .join("")

  return page({
    title: "Save to memory?",
    body:
      `<span class="who">${esc(session.user.email)}</span>` +
      `<h1>Save this to memory?</h1>` +
      // `clientId` is the verified OAuth client_id from a signed token, not a self-reported
      // name — so it is safe to attribute the suggestion to it.
      `<p>Suggested by <strong>${esc(negotiation.clientId)}</strong>. ` +
      `Nothing has been saved yet.</p>` +
      `<div class="fact">${esc(negotiation.fact)}</div>` +
      (nearDuplicate
        ? `<div class="warn">You already have something similar: ` +
          `“${esc(nearDuplicate.fact)}”.` +
          `<label class="opt" style="margin-top:10px;background:var(--card)">` +
          `<input type="checkbox" id="replaces">` +
          `<div><strong>Replace it</strong><span>Supersede the old fact instead of ` +
          `keeping both.</span></div></label></div>`
        : "") +
      `<fieldset><legend>How widely should it apply?</legend>${scopeInputs}</fieldset>` +
      `<div class="row">` +
      `<button class="primary" id="save">Save</button>` +
      `<button id="not-now">Not now</button>` +
      `<button id="never">Never save this</button>` +
      `</div>` +
      `<p class="note">“Not now” saves nothing and pauses the suggestion. ` +
      `“Never save this” suppresses the fact permanently — it will not be suggested again.</p>`,
    script: resolveScript(negotiationId),
  })
})

/**
 * Posts the decision to the existing human-plane endpoint.
 *
 * `credentials: "same-origin"` sends the session cookie, which is what authorises the write.
 * The agent that proposed this is not involved: it learns the outcome only by retrying its
 * own tool call, which reads the settled row.
 */
function resolveScript(negotiationId: string): string {
  return `
const done = (msg) => {
  document.querySelector("main").innerHTML =
    '<h1>' + msg + '</h1><p>You can close this tab and carry on where you were.</p>';
};
const send = async (action) => {
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  const scope = document.querySelector('input[name="scope"]:checked');
  const replaces = document.getElementById("replaces");
  const body = { action };
  if (action === "accept") {
    body.scope = scope ? scope.value : undefined;
    if (replaces && replaces.checked) body.replacesExisting = true;
  }
  try {
    const res = await fetch(${JSON.stringify(`/api/negotiations/${negotiationId}/resolve`)}, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error && data.error.message) || "That did not go through.");
    const status = data && data.result && data.result.status;
    if (status === "committed") return done("Saved.");
    if (status === "declined") return done("Suppressed. It will not be suggested again.");
    if (status === "cancelled") return done("Nothing was saved.");
    if (status === "already_known") return done("You already had that one.");
    return done("Done.");
  } catch (err) {
    for (const b of document.querySelectorAll("button")) b.disabled = false;
    const p = document.createElement("p");
    p.className = "warn";
    p.textContent = err.message + " Please try again.";
    document.querySelector(".row").before(p);
  }
};
document.getElementById("save").onclick = () => send("accept");
document.getElementById("not-now").onclick = () => send("cancel");
document.getElementById("never").onclick = () => send("decline");
`
}

function gone(message: string): Response {
  return page({
    status: 410,
    title: "Nothing to approve",
    body: `<h1>Nothing to approve</h1><p>${esc(message)}</p>`,
  })
}

/** Already answered — most often a refresh, or a second tab on the same link. */
function settled(status: string): Response {
  const said =
    status === "accepted"
      ? "You already saved that one."
      : status === "declined"
        ? "You suppressed that fact. It will not be suggested again."
        : status === "cancelled"
          ? "You dismissed that suggestion. Nothing was saved."
          : "That suggestion expired before it was answered."

  return page({
    title: "Already answered",
    body: `<h1>Already answered</h1><p>${esc(said)}</p>`,
  })
}
