# Opening the memory platform to other AI agents

**Status: steps 0–3 are built and passing.** Discovery, the OAuth 2.1 authorization server,
the `/mcp` resource server, both tools, and the full consent round-trip all work end to end
against `wrangler dev`. Run `bun run test:mcp` (with `bun run dev` in another terminal) —
49 assertions, including seven that specifically try to break the consent model.

Still to do: step 4 (rate limits, showing origin client in the timeline UI, a revoke screen)
and step 5 (public docs page, registry listing, testing against real clients). See Part 7.

## What we're building, in one sentence

Right now only *your* chat app can use the memory engine. We're going to add a second
door so that **any** AI agent — Claude, Cursor, VS Code, ChatGPT, someone's homemade bot
— can search a user's memories and suggest new ones, while still being unable to save
anything without the human personally approving it.

The standard way to do that is called **MCP** (Model Context Protocol). An "MCP server"
is just a web endpoint that speaks a agreed-upon format so any AI tool can plug into it.

---

## Part 1 — The good news: you already built for this

Three comments in your own code predicted this exact moment:

**`src/context.ts` line 18**
> `clientId` — `web` today. A verified OAuth client id once MCP clients can connect.

**`src/db/schema.ts` line 132**
> When MCP lands, external clients get the same row via a hashed handle instead — the
> table shape does not change.

**`packages/shared/src/negotiation.ts` line 12**
> MCP's elicitation works exactly this way: a tool call returns "input required", the
> request *terminates*, and the client comes back with the answer as a fresh request.

So this is not a rewrite. **Nothing inside `src/memory/` changes.** We're adding a new
entrance to a building that was already designed to have two.

---

## Part 2 — The shape of it

Think of the memory engine as a vault in the basement. Today there's one staircase down
to it (your chat app). We're adding a second staircase (MCP), and both end up in the same
room.

```
   Your chat app  ──────►  chat/loop.ts  ──────┐
   (logged in with                              │
    a browser cookie)                           │
                                                ├──►  src/memory/*
   Someone else's AI  ──►  NEW: mcp/handler.ts ─┤     (D1 + Vectorize)
   (logged in with                              │      ← unchanged
    an OAuth token)                             │
                                                │
   A human in a browser ─►  negotiations.ts ────┘
   (approving a save)        ← the only path that can WRITE
```

The key point: the two staircases differ **only** in how they figure out who's asking.
Once identity is established, they call the exact same functions.

### What we get for free

Your code identifies every caller with a `clientId`, currently hardcoded to `"web"`. When
the MCP door sets it to the real OAuth client id instead, three things you already built
start working per-agent with **zero new code**:

| Already in your code | What it starts doing |
| --- | --- |
| `negotiations.clientId` | You can see which agent suggested each fact |
| `memories.originClient` | The timeline can say "Cursor suggested this" |
| `PROPOSAL_QUOTA_PER_HOUR = 40` | Already counts per-client → becomes a per-agent budget |

---

## Part 3 — The one hard problem (and this is the whole design)

### The problem

Your product's entire promise is: **an agent can suggest a memory, but only a human can
save it.** `propose()` writes to a temporary table. `resolve()` writes to the real one,
and `resolve()` is only reachable by a logged-in human in a browser.

Now an outside AI wants to propose something. How does the human approve it?

### The tempting-but-wrong answer

MCP has a built-in feature called "form elicitation": your server can say *"ask the user
this question"*, and the AI's app pops up a little form. Looks perfect. Scope dropdown,
Save button, done.

**It quietly destroys the guarantee.**

Here's why. The answer comes back through the *same connection, using the same access
token the AI already has*. Your server has no way to tell these two apart:

- A real human clicked "Save", scope: global
- The AI just made up `{"action": "accept", "scope": "global"}` and sent it

It's like a delivery driver asking you to sign for a package — versus the driver signing
your name themselves and posting the photo. You can't tell from the signature.

So a buggy AI client, or one that got prompt-injected, approves its own suggestions. Your
consent gate becomes decoration — which is the exact phrase your own code uses at
`routes/negotiations.ts` line 13.

### The right answer

Don't collect the signature through the AI. Make the human come to **your** front desk.

MCP has a second flavour of the same feature: **URL elicitation**. Instead of a form, your
server hands back a *link*:

> "Nothing has been saved. Open https://memory.byvent.com/consent/neg_01J… to approve."

The user opens it in their normal browser. They're already logged into your app, so their
**session cookie** proves who they are — and that cookie is something the AI client
absolutely does not have and cannot fake. They see the same approval chip your web app
already shows, and clicking Save hits the **existing, unchanged**
`POST /api/negotiations/:id/resolve`.

Meanwhile the AI just checks back periodically: "approved yet?" Your server looks at the
row and answers "still waiting" or "here's what they decided."

```
1.  AI:     "Save this: user prefers tabs over spaces"
2.  You:    "Not saved. A human must approve: <link>"
3.  Human:  opens link in browser (cookie proves it's really them)
            → clicks Save, picks "global"
4.  AI:     "Approved yet?"
5.  You:    "Yes — saved with global scope."
```

Same guarantee as today. The write still only happens on a cookie-authenticated human
request. The AI never touches it.

**If an AI client is too old to handle links:** just return the link as plain text in the
tool result. The model relays it to the user. Slightly clunkier, identical safety. We
never fall back to form-mode approval.

### One attack to close

The MCP spec warns about this and it's worth understanding:

> Alice gets a consent link. She doesn't click it. Instead she tricks Bob — another real
> user of your app — into opening it. Bob is logged in, sees a Save button, clicks it.
> **Alice's fact just got saved, approved by Bob.**

The fix is one line, because the data is already there. The negotiation row knows who it
belongs to:

```ts
if (negotiation.userId !== session.user.id) return forbidden()
```

Not optional. Easy to forget.

---

## Part 4 — Logging the agents in (OAuth)

An outside AI needs permission to reach a specific user's memories. That's OAuth — the
same "Sign in with…" dance you've used a hundred times, just with an AI as the app.

### Who plays which role

| Role | Who | What it does |
| --- | --- | --- |
| The app asking for access | The AI (Claude, Cursor…) | wants a token |
| The login/permission server | **your app** | shows the user a "Cursor wants to read your memories — allow?" screen, issues the token |
| The thing being protected | **your `/mcp` endpoint** | checks the token on every request |

Your app plays two of the three roles. That's good — it's what makes the consent page in
Part 3 work, because the login server and the memory server share the same session cookie.

### What to use

**Better Auth's `oauthProvider` plugin**, in the same Worker. You're already on
`better-auth@1.6.26`, and the plugin already handles nearly everything the MCP spec
demands: OAuth 2.1, PKCE, issuer validation, letting new AI clients register themselves,
audience-locked tokens, discovery endpoints, a consent screen, and rate limiting.

We considered Cloudflare's `workers-oauth-provider` instead. Rejected — it would create a
second, separate user system next to Better Auth and split your `user` table in half.
Then the consent page can't compare "the browser user" to "the token user", and Part 3
falls apart.

Cost: one D1 migration adding a few OAuth tables.

### Permissions we hand out

```
memory:read      → lets an agent use search_memory
memory:propose   → lets an agent use propose_memory
```

That's it. **There is deliberately no "write" permission**, because no agent can write —
so there's nothing to grant. The permission list is itself a statement of what the product
is. When someone asks you to add `save_memory` or `forget` as MCP tools, the answer is
already written at `src/chat/tools.ts` lines 10–16.

### One known gap, and it's fine

The newest spec version prefers a brand-new way for AI clients to identify themselves
(called CIMD). Better Auth doesn't support it yet. The older mechanism still works, and
the spec explicitly tells clients to fall back to it. So: use the old one, don't advertise
support for the new one, revisit later. Not a blocker.

---

## Part 5 — Two doors, two keys, never mixed up

This is the part where a single careless line could undo everything, so it gets its own
section.

| Door | Key | Who | Can it save memories? |
| --- | --- | --- | --- |
| `/api/negotiations/:id/resolve` | browser **cookie** | human | **yes** |
| `/mcp` | OAuth **token** | agent | **no** |

These must never accept each other's key.

### The trap

`requireUser` in `src/middleware/auth.ts` calls `auth.api.getSession({ headers })`. Today
that reads **cookies only** — because Better Auth's `bearer` plugin is not turned on.

**Never turn on the `bearer` plugin.**

If you do, `getSession` starts accepting `Authorization: Bearer <token>`. That means an
agent's token now satisfies `requireUser`, which means the agent can call `resolve()`,
which means **it can approve its own suggestions.** One line of config. No test fails.
Everything still looks fine.

So: build two separate middlewares that can't be confused, and write a test that asserts
*"an OAuth token gets 401 on the resolve endpoint."* That test is the guardrail.

---

## Part 6 — What actually gets built

### New files

```
src/mcp/
  index.ts       the /mcp route
  handler.ts     wires up the two tools
  auth.ts        checks the OAuth token, works out who's asking
  tools.ts       thin adapters onto src/memory/*
  state.ts       tamper-proof "which proposal was this?" token
  metadata.ts    the discovery documents AI clients look for
src/routes/
  consent.ts     the approval page from Part 3
packages/shared/
  tools.ts       the two tool definitions, in ONE place
```

That last one matters. Right now `CHAT_TOOLS` in `src/chat/tools.ts` hand-writes JSON
schemas that duplicate your Zod schemas. Add MCP and you'd have *three* copies that can
drift apart. Zod 4 can generate JSON Schema directly (`z.toJSONSchema()`), so one
definition can feed both doors. Cheap to do now, annoying later.

### Files that change

| File | Why |
| --- | --- |
| `wrangler.jsonc` | routing fix (see gotcha #1) + new secrets |
| `src/index.ts` | mount the new routes |
| `src/auth.ts` | add the OAuth plugin |
| `src/db/schema.ts` + a migration | OAuth tables |
| `src/middleware/auth.ts` | add the token-checking middleware |
| `src/chat/tools.ts` | read tool definitions from the shared package |
| `src/env.ts` | new secrets |

---

## Part 7 — Order of work (~2 weeks)

| Step | What | Time |
| --- | --- | --- |
| **0** | Routing fix, pass `clientId` through, move tool definitions to shared | half a day |
| **1** | Turn your app into an OAuth login server | 1–2 days |
| **2** | Build `/mcp` and ship **`search_memory` only** | 2–3 days |
| **3** | Add `propose_memory` with the whole consent round-trip | 2–3 days |
| **4** | Hardening: rate limits, show which agent proposed what, let users revoke an agent's access | 1–2 days |
| **5** | Docs page, list in the MCP registry, test against real clients | 1 day |

**Step 2 is worth shipping on its own.** A read-only MCP server — agents can recall your
memories but not even suggest new ones — is a complete, useful product, and it postpones
every hard question in Part 3. Strongly recommend stopping there and shipping before
starting step 3.

---

## Part 7a — What building it actually turned up

Six things the plan did not predict. All are fixed; they are recorded because each was
invisible until something ran.

**1. Provenance was being lost — a real pre-existing bug.**
`commitMemory` set `origin_client` from `ctx.clientId`, i.e. whoever was *committing*. Over
MCP that is always the browser, so every agent-proposed memory would have been recorded as
having come from the web app — silently erasing the one column that exists to say otherwise.
`CommitMemoryInput` (and `tombstone`) now take an explicit `originClient`, passed from the
frozen negotiation row. TypeScript could not catch this: both values are strings.

**2. All origins must resolve from one place.**
Deriving the resource identifier from the request URL looked obvious and was wrong. A Worker
answers on several hostnames (`*.workers.dev`, the custom domain, whatever `wrangler dev`
picks), so a client arriving on one could be issued a token audience-locked to another and
be rejected on every call with a 401 that explains nothing. `resolveOrigin` in
`src/mcp/config.ts` is now the single source, preferring `BETTER_AUTH_URL`.

**3. The authorization server issuer needed pinning.**
Better Auth defaults its issuer to its own base path (`/api/auth`), which makes clients probe
`/.well-known/oauth-authorization-server/api/auth`. Pinning the JWT plugin's issuer to the
bare origin keeps discovery to one root route. RFC 8414 requires the `issuer` in the document
to match the identifier used to build the URL that served it, so these two cannot be chosen
independently.

**4. `better-auth/oauth2` does not export `verifyAccessToken` in 1.6.26**, even though
`@better-auth/oauth-provider@1.6.26` imports it in its own types. `mcpHandler` from that
package is therefore unusable here. Tokens are verified directly with `jose` against
`/api/auth/jwks` — which is better anyway, because audience validation is the security-
critical step and it should be explicit and readable.

**5. The consent endpoint returns `{ redirect, url }`, not `{ redirect_uri }`.** The
documented field name is wrong. The Allow button silently stranded the user on a dead screen
while the client waited for a callback that never came. Now accepts either.

**6. `getClientCapabilities()` is on the low-level `Server`, not `McpServer`** — reached via
`server.server`. This is what decides URL-mode elicitation versus the text fallback, so
getting it wrong would have sent 2025-era clients an elicitation they cannot render.

Two more worth knowing, neither a bug:

- **The SDK ships Cloudflare support properly.** `@modelcontextprotocol/server@2.0.0` has a
  `workerd` export condition that swaps in a `@cfworker/json-schema` validator (AJV uses
  `eval`, which Workers block) and bundles it — no extra dependency, nothing to configure.
- **Better Auth requires an `Origin` header** on state-changing requests
  (`MISSING_OR_NULL_ORIGIN`). Browsers always send one, so this only affects test harnesses
  and scripts.

---

## Part 8 — Things that will bite you

**1. The routing bug you'd hit in the first five minutes.**
`wrangler.jsonc` line 35 says `run_worker_first: ["/api/*"]`. The new endpoints
(`/mcp`, `/.well-known/*`) aren't under `/api/`, so Cloudflare serves them from the static
asset store instead of your Worker — and because of the SPA fallback, they return
**`index.html` with a 200 OK.** An AI client asks for configuration JSON, gets a webpage,
and fails somewhere deep inside its parser with a useless error. Fix:

```jsonc
"run_worker_first": ["/api/*", "/mcp", "/.well-known/*", "/consent/*"]
```

**2. The `bearer` plugin.** Part 5. The worst one, because nothing breaks visibly.

**3. Leave `cache.enabled` as `false`.** Your comment at `wrangler.jsonc` lines 17–24
already explains why for cookies — it's *more* true for `/mcp`, where the only difference
between two users is an `Authorization` header.

**4. Browser-based AI clients can't see your error messages** unless you explicitly expose
the `WWW-Authenticate` header in CORS. Without it, login discovery just dead-ends. Your
current CORS setup in `src/index.ts` doesn't expose it.

**5. Your search tuning was measured on humans.** `MIN_SEMANTIC_SCORE = 0.62` in
`retrieval.ts` was calibrated against how people type. Agents write shorter, more
keyword-y queries. Re-measure once real MCP traffic exists — the comment above it already
tells you how.

**6. Session-scoped memories need a small addition.** "Session" scope means "only in this
conversation", and MCP has no concept of a conversation. So we add an optional `thread`
argument an agent can pass.

The nice part: **if the agent forgets it, nothing breaks.** `propose()` builds the list of
offered scopes from what actually resolved, so with no thread, "session" simply isn't
offered and the user only sees project/global. It fails in the safe direction, using logic
you already wrote.

**7. Retries are now normal.** Your tool description says *"Never call this twice for the
same fact."* MCP's design means retries happen by protocol. That's fine — your
fingerprint, tombstone, cooldown and duplicate checks already make a repeat call cheap and
harmless. Keep the sentence; rely on the guards, not the model's obedience.

---

## Part 9 — Not doing (for now)

- **Letting your chat app connect *out* to other MCP servers.** That's the opposite
  direction and a different security problem. Separate project.
- **Exposing memories as MCP "resources" or "prompts".** Two tools is the product. Every
  extra surface is one more thing that has to respect the scope rules.
- **Adding `save_memory` / `forget` / `set_scope` as agent tools.** Ever. See
  `src/chat/tools.ts` lines 10–16.

---

## Appendix — reference details

For implementation, the exact spec requirements:

- Protocol revision: **`2026-07-28`**. No `initialize` handshake, no session ids. Every
  request carries `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` headers, which **must**
  be validated against the request body (error `-32020` if they disagree).
- `GET` and `DELETE` on `/mcp` → `405`. Ignore `Mcp-Session-Id` and `Last-Event-ID`.
- `tools/list` results can be cached — set `ttlMs` and `cacheScope: "public"`, since the
  tool list here never changes.
- Unauthenticated request →
  `401` + `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp", scope="memory:read"`
- Token missing a permission →
  `403` + `WWW-Authenticate: Bearer error="insufficient_scope", scope="memory:propose", resource_metadata="…"`
  — list **all** needed permissions in one go, not one at a time.
- Tokens must be audience-locked to `https://memory.byvent.com/mcp` and rejected
  otherwise. Never forward a client's token onward to OpenRouter or anywhere else.
- The "which proposal was this?" token (`requestState`) must be HMAC-sealed and must
  carry the user id, an expiry, and a fingerprint of the request. Verify all three —
  the spec says to treat it as attacker-controlled. Single-use is already handled: your
  `resolve()` replays the stored outcome if the row isn't `pending`.
- Library: `@modelcontextprotocol/server@2.0.0`. ESM-only, plain `fetch` handler, runs on
  Workers. Provides `createMcpHandler`, `inputRequired()`, `createRequestStateCodec()`.
- It can also serve older AI clients that still expect the old handshake — keep that on,
  since most deployed clients in 2026 are still on older versions. Those clients get the
  plain-text link fallback for `propose_memory`.
