import { and, eq } from "drizzle-orm"
import { Hono } from "hono"

import { createAuth } from "../auth"
import { createDb } from "../db/client"
import { oauthClient } from "../db/schema"
import type { AppBindings } from "../env"
import { esc, page, signInFirst } from "../lib/html"
import { SCOPE_COPY } from "../mcp/config"

/**
 * `GET /oauth/consent` — the OAuth grant screen.
 *
 * Better Auth's authorization endpoint sends the user here (after login) with `client_id`,
 * `scope` and `code` in the query string. We show who is asking and what for; accepting
 * POSTs back to `/api/auth/oauth2/consent`, which answers with the `redirect_uri` to hand
 * the user back to the client.
 *
 * This is the *connection* consent — "may Cursor read my memories at all". It is a
 * different question from the per-fact consent at `/consent/:negotiationId`, and granting
 * this one never implies the other. That is the whole point: an agent can hold this grant
 * indefinitely and still be unable to save a single fact.
 */
export const oauthConsentRoute = new Hono<AppBindings>()

oauthConsentRoute.get("/consent", async (c) => {
  const origin = new URL(c.req.url).origin
  const auth = createAuth(c.env, origin)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })

  if (!session?.user) {
    return signInFirst(
      origin,
      "An application is asking to connect to your memory."
    )
  }

  const clientId = c.req.query("client_id")
  if (!clientId) {
    return page({
      status: 400,
      title: "Invalid request",
      body:
        `<h1>Something is missing</h1>` +
        `<p>This authorization link is incomplete, so there is nothing to approve. ` +
        `Start the connection again from the application you were using.</p>`,
    })
  }

  // Requested scopes come from the query string, which the authorization endpoint built —
  // but they are still rendered as data, never trusted as a list of things we support. Only
  // scopes we have copy for are shown; an unknown one would otherwise appear as a blank row
  // the user cannot evaluate.
  const requested = (c.req.query("scope") ?? "").split(/[\s+]+/).filter(Boolean)
  const known = requested.filter((scope) => scope in SCOPE_COPY)

  const client = await createDb(c.env.DB).query.oauthClient.findFirst({
    where: and(
      eq(oauthClient.clientId, clientId),
      eq(oauthClient.disabled, false)
    ),
    columns: { name: true, uri: true },
  })

  // Dynamically registered clients choose their own `client_name`, so it is attacker-chosen
  // text. Escaped, and never rendered as a link even when the client supplied a `uri`.
  const label = client?.name?.trim() || "An application"

  const scopeList = known
    .map((scope) => {
      const copy = SCOPE_COPY[scope]!
      return `<li><strong>${esc(copy.title)}</strong><span>${esc(copy.detail)}</span></li>`
    })
    .join("")

  return page({
    title: "Connect an application",
    body:
      `<span class="who">${esc(session.user.email)}</span>` +
      `<h1>${esc(label)} wants to connect</h1>` +
      `<p class="lead">It is asking for these permissions on your memory.</p>` +
      (scopeList
        ? `<ul class="scopes">${scopeList}</ul>`
        : `<p class="warn">This application did not ask for any permission this server ` +
          `recognises. Approving it would grant nothing.</p>`) +
      `<div class="row">` +
      `<button class="primary" id="allow">Allow</button>` +
      `<button id="deny">Deny</button>` +
      `</div>` +
      `<p class="note">You can disconnect this application at any time from Settings.</p>`,
    script: decide(),
  })
})

/**
 * Both buttons take the same path so a denial is recorded rather than abandoned: the
 * authorization server needs to send `access_denied` back to the client's `redirect_uri`,
 * and a user who just closes the tab leaves the client hanging instead.
 *
 * `oauth_query` is this page's own query string, echoed back so the endpoint can match the
 * decision to the pending authorization.
 */
function decide(): string {
  return `
const send = async (accept) => {
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  try {
    const res = await fetch("/api/auth/oauth2/consent", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accept, oauth_query: location.search })
    });
    const data = await res.json().catch(() => null);
    // Better Auth answers { redirect, url }; older builds documented redirect_uri. Accept
    // either, because getting this wrong strands the user on a dead consent screen while
    // the client waits for a callback that never arrives.
    const next = data && (data.url || data.redirect_uri);
    if (res.ok && next) { location.href = next; return; }
    throw new Error((data && data.message) || "That did not go through.");
  } catch (err) {
    for (const b of document.querySelectorAll("button")) b.disabled = false;
    const p = document.createElement("p");
    p.className = "warn";
    p.textContent = err.message + " Please try again.";
    document.querySelector(".row").before(p);
  }
};
document.getElementById("allow").onclick = () => send(true);
document.getElementById("deny").onclick = () => send(false);
`
}
