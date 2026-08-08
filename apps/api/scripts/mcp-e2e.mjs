/**
 * End-to-end MCP conformance and guardrail test.
 *
 *   bun run dev        # in one terminal
 *   bun run test:mcp   # in another
 *
 * Walks the whole flow an external agent takes — dynamic client registration, sign-in, PKCE
 * authorize, consent, token exchange, tools/list, search, and the two-phase consent
 * round-trip — and then asserts the guardrails that actually matter:
 *
 *   [10] an agent's access token CANNOT reach POST /api/negotiations/:id/resolve
 *   [11] a tampered `requestState` is refused
 *   [16] headers that disagree with the body are refused (-32020)
 *   [17] a token without `memory:propose` gets 403 and a challenge naming the scope
 *   [18] a token minted for another audience cannot open /mcp
 *   [20] a different signed-in user cannot open someone else's consent page (phishing)
 *   [21] a client with no url-elicitation gets a text link, never a form-mode approval
 *
 * Each of those is a distinct way the consent model could be broken. If one starts failing,
 * something load-bearing has changed — read docs/mcp-server-plan.md before "fixing" it.
 *
 * WRITES REAL ROWS: one OAuth client, two user accounts, and a few memories. Everything it
 * creates is tagged `mcp-verify-<timestamp>` so it can be found and deleted afterwards. Safe
 * to run against a deployment, but it is not read-only — know that before pointing it at one.
 */
/**
 * Point at a deployment with MCP_BASE, e.g.
 *   MCP_BASE=https://memory.byvent.com node scripts/mcp-e2e.mjs
 */
const B = (process.env.MCP_BASE ?? "http://localhost:8787").replace(/\/+$/, "")

/**
 * The Origin a browser would send. In dev the SPA is served by Vite on :5173; in production
 * it shares the API's origin. Better Auth checks this against `trustedOrigins`.
 */
const WEB_ORIGIN = (
  process.env.MCP_WEB_ORIGIN ?? (B.includes("localhost") ? "http://localhost:5173" : B)
).replace(/\/+$/, "")

const RESOURCE = `${B}/mcp`
const REDIRECT = "http://127.0.0.1:9876/callback"

/** Labelled so anything this leaves behind is easy to find and delete. */
const TAG = `mcp-verify-${Date.now()}`
const CLIENT_NAME = "MCP Verification (safe to delete)"

console.log(`\ntarget: ${B}   (browser origin: ${WEB_ORIGIN})`)
console.log(`test data tagged: ${TAG}`)

let cookie = ""
const ok = (label, cond, extra = "") =>
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`)

function captureCookie(res) {
  const set = res.headers.getSetCookie?.() ?? []
  for (const c of set) {
    const kv = c.split(";")[0]
    if (!kv) continue
    const name = kv.split("=")[0]
    const parts = cookie.split("; ").filter((p) => p && p.split("=")[0] !== name)
    parts.push(kv)
    cookie = parts.join("; ")
  }
}

async function j(url, init = {}) {
  // Better Auth rejects state-changing requests with no Origin (MISSING_OR_NULL_ORIGIN).
  // A browser always sends one; this harness stands in for a browser, so it does too.
  const res = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: { Origin: WEB_ORIGIN, ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) },
  })
  captureCookie(res)
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { res, body }
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

// --- MCP request helper -----------------------------------------------------
let mcpId = 0
async function mcp(token, method, params = {}, name) {
  mcpId += 1
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": method,
  }
  if (name) headers["Mcp-Name"] = name

  const res = await fetch(`${B}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: mcpId,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "e2e-test", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": { elicitation: { form: {}, url: {} } },
        },
      },
    }),
  })
  const text = await res.text()
  // The transport may answer with a single JSON object or an SSE stream.
  if (text.startsWith("event:") || text.includes("\ndata: ")) {
    const line = text.split("\n").reverse().find((l) => l.startsWith("data: "))
    return { status: res.status, body: line ? JSON.parse(line.slice(6)) : null }
  }
  try { return { status: res.status, body: JSON.parse(text) } }
  catch { return { status: res.status, body: text } }
}

// ---------------------------------------------------------------------------

console.log("\n[1] Dynamic client registration")
const reg = await j(`${B}/api/auth/oauth2/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_name: CLIENT_NAME,
    redirect_uris: [REDIRECT],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "native",
    scope: "memory:read memory:propose",
  }),
})
ok("registered", Boolean(reg.body?.client_id), reg.body?.client_id ?? JSON.stringify(reg.body).slice(0, 300))
const clientId = reg.body.client_id
if (!clientId) process.exit(1)

console.log("\n[2] Sign up a user (browser cookie)")
const email = `${TAG}-a@example.com`
const signup = await j(`${B}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "correct-horse-battery", name: "E2E User" }),
})
ok("signed up", signup.res.status < 400 && cookie.length > 0, `status ${signup.res.status}`)

console.log("\n[3] Authorize (PKCE + resource indicator)")
const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
const state = b64url(crypto.getRandomValues(new Uint8Array(16)))
const authQuery = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: "memory:read memory:propose",
  code_challenge: challenge,
  code_challenge_method: "S256",
  resource: RESOURCE,
  state,
})
const authz = await j(`${B}/api/auth/oauth2/authorize?${authQuery}`)
// Better Auth answers a 302 to a browser and `{redirect, url}` to a JSON caller.
const consentLocation = authz.res.headers.get("location") ?? authz.body?.url ?? ""
ok("redirected to consent page", consentLocation.includes("/oauth/consent"), `${authz.res.status} ${consentLocation.slice(0, 80)}`)

console.log("\n[4] Consent page renders")
const consentPath = consentLocation.startsWith("http") ? consentLocation : `${B}${consentLocation}`
const consentPage = await j(consentPath)
const html = typeof consentPage.body === "string" ? consentPage.body : ""
ok("shows client name", html.includes(CLIENT_NAME))
ok("shows read scope", html.includes("Read your memories"))
ok("says it cannot save", html.includes("cannot save anything itself"))

console.log("\n[5] Grant consent")
const consentQuery = consentPath.slice(consentPath.indexOf("?"))
const granted = await j(`${B}/api/auth/oauth2/consent`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ accept: true, oauth_query: consentQuery }),
})
const redirectUri = granted.body?.url ?? granted.body?.redirect_uri ?? ""
ok("got redirect_uri with code", redirectUri.includes("code="), `${granted.res.status} ${String(redirectUri).slice(0, 140)}`)
const cb = new URL(redirectUri || "http://x/")
const code = cb.searchParams.get("code")
ok("iss present (RFC 9207)", cb.searchParams.get("iss") === B, cb.searchParams.get("iss") ?? "absent")
ok("state echoed", cb.searchParams.get("state") === state)

console.log("\n[6] Exchange code for token")
const tok = await j(`${B}/api/auth/oauth2/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id: clientId,
    code_verifier: verifier,
    resource: RESOURCE,
  }).toString(),
})
const token = tok.body?.access_token
ok("got access_token", Boolean(token), token ? "" : JSON.stringify(tok.body).slice(0, 300))
if (!token) process.exit(1)

const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
ok("aud is the MCP resource", claims.aud === RESOURCE || (Array.isArray(claims.aud) && claims.aud.includes(RESOURCE)), JSON.stringify(claims.aud))
ok("iss is the origin", claims.iss === B, claims.iss)
ok("azp is the client_id", claims.azp === clientId, claims.azp)
ok("scope carries both", String(claims.scope).includes("memory:read") && String(claims.scope).includes("memory:propose"), claims.scope)

console.log("\n[7] tools/list")
const list = await mcp(token, "tools/list")
const tools = list.body?.result?.tools ?? []
ok("two tools", tools.length === 2, tools.map((t) => t.name).join(", "))
ok("cacheable (ttlMs)", list.body?.result?.ttlMs > 0, `ttlMs=${list.body?.result?.ttlMs} scope=${list.body?.result?.cacheScope}`)
ok("propose is not readOnly", tools.find((t) => t.name === "propose_memory")?.annotations?.readOnlyHint === false)

console.log("\n[8] search_memory (empty store)")
const search = await mcp(token, "tools/call", { name: "search_memory", arguments: { query: "tabs or spaces" } }, "search_memory")
ok("returned a result", search.body?.result?.isError === false, JSON.stringify(search.body?.result?.content ?? search.body).slice(0, 200))

console.log("\n[9] propose_memory -> URL elicitation")
const propose = await mcp(token, "tools/call", { name: "propose_memory", arguments: { fact: "Prefers tabs over spaces", category: "preference", suggestedScope: "global" } }, "propose_memory")
const result = propose.body?.result
ok("resultType is input_required", result?.resultType === "input_required", result?.resultType ?? JSON.stringify(propose.body).slice(0, 300))
const elicit = result?.inputRequests?.consent
ok("url-mode elicitation", elicit?.params?.mode === "url", JSON.stringify(elicit?.params ?? {}).slice(0, 200))
ok("requestState minted", typeof result?.requestState === "string" && result.requestState.startsWith("v1."))
const consentUrl = elicit?.params?.url ?? ""
const negotiationId = consentUrl.split("/consent/")[1] ?? ""
ok("consent url points at our origin", consentUrl.startsWith(`${B}/consent/`), consentUrl)

// Everything after this needs a live proposal. Bail with a clear message rather than
// cascading twenty misleading failures — the usual cause is `wrangler dev` reloading
// mid-run because a source file changed.
if (!negotiationId || typeof result?.requestState !== "string") {
  console.log("\nABORT: no pending proposal to work with — cannot check the consent round-trip.")
  console.log("       If the server just reloaded, wait for it to settle and re-run.")
  process.exit(1)
}

console.log("\n[10] GUARDRAIL: agent token must not reach resolve()")
const forged = await fetch(`${B}/api/negotiations/${negotiationId}/resolve`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ action: "accept", scope: "global" }),
})
ok("bearer token rejected on human plane", forged.status === 401, `status ${forged.status}`)

console.log("\n[11] GUARDRAIL: requestState is not forgeable")
const forgedState = await mcp(token, "tools/call", { name: "propose_memory", arguments: { fact: "Prefers tabs over spaces", category: "preference" }, requestState: "v1.eyJwIjp7Im5lZ290aWF0aW9uSWQiOiJmYWtlIn0sImV4cCI6OTk5OTk5OTk5OX0.AAAA" }, "propose_memory")
ok("tampered state refused", forgedState.body?.error?.code === -32602, JSON.stringify(forgedState.body?.error ?? forgedState.body).slice(0, 200))

console.log("\n[12] Consent page (the human, with a cookie)")
const cpage = await j(`${B}/consent/${negotiationId}`)
const chtml = typeof cpage.body === "string" ? cpage.body : ""
ok("renders the fact", chtml.includes("Prefers tabs over spaces"), `status ${cpage.res.status}`)
ok("attributes the client", chtml.includes(clientId))
ok("offers global scope", chtml.includes('value="global"'))
ok("does not offer session scope (no thread)", !chtml.includes('value="session"'))

console.log("\n[13] Human approves")
const approve = await j(`${B}/api/negotiations/${negotiationId}/resolve`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "accept", scope: "global" }),
})
ok("committed", approve.body?.result?.status === "committed", JSON.stringify(approve.body).slice(0, 160))
// Provenance must name the PROPOSER (the MCP client), not the approver (the browser).
ok("origin_client is the MCP client", approve.body?.result?.memory?.originClient === clientId, `got ${approve.body?.result?.memory?.originClient}`)
ok("scope is what the human chose", approve.body?.result?.memory?.scope === "global")

console.log("\n[14] Agent retries -> collects the outcome")
const retry = await mcp(token, "tools/call", { name: "propose_memory", arguments: { fact: "Prefers tabs over spaces", category: "preference" }, requestState: result.requestState, inputResponses: { consent: { action: "accept" } } }, "propose_memory")
ok("resultType complete", retry.body?.result?.resultType === "complete", retry.body?.result?.resultType ?? JSON.stringify(retry.body).slice(0, 240))
ok("reports committed", retry.body?.result?.structuredContent?.status === "committed", JSON.stringify(retry.body?.result?.structuredContent ?? {}).slice(0, 200))

console.log("\n[15] search_memory now finds it")
const search2 = await mcp(token, "tools/call", { name: "search_memory", arguments: { query: "tabs spaces indentation" } }, "search_memory")
const found = search2.body?.result?.structuredContent?.memories ?? []
ok("memory retrievable", found.some((m) => m.fact.includes("tabs")), JSON.stringify(found).slice(0, 240))

console.log("\n[16] GUARDRAIL: header/body mismatch")
const mismatch = await fetch(`${B}/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": "search_memory" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "propose_memory", arguments: { fact: "sneaky", category: "fact" }, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } }),
})
const mmBody = await mismatch.json().catch(() => null)
ok("rejected -32020", mmBody?.error?.code === -32020, `status ${mismatch.status} ${JSON.stringify(mmBody?.error ?? mmBody).slice(0, 160)}`)

/**
 * Full authorize -> consent -> token flow, reusable. Handles the case where the user has
 * already consented to this client, in which case the AS skips the consent page and
 * redirects straight to the callback.
 */
async function getToken(scope, resource) {
  const v = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const ch = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: REDIRECT, response_type: "code", scope,
    code_challenge: ch, code_challenge_method: "S256", resource,
  })
  const a = await j(`${B}/api/auth/oauth2/authorize?${q}`)
  let target = a.res.headers.get("location") ?? a.body?.url ?? ""
  if (target.includes("/oauth/consent")) {
    const g = await j(`${B}/api/auth/oauth2/consent`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accept: true, oauth_query: target.slice(target.indexOf("?")) }),
    })
    target = g.body?.url ?? g.body?.redirect_uri ?? ""
  }
  if (!target.includes("code=")) return { error: `no code: ${a.res.status} ${target.slice(0, 120)}` }
  const code = new URL(target).searchParams.get("code")
  const t = await j(`${B}/api/auth/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: REDIRECT,
      client_id: clientId, code_verifier: v, resource,
    }).toString(),
  })
  if (!t.body?.access_token) return { error: JSON.stringify(t.body).slice(0, 160) }
  const c = JSON.parse(Buffer.from(t.body.access_token.split(".")[1], "base64url").toString())
  return { token: t.body.access_token, claims: c }
}

async function callTool(token, name, args) {
  const res = await fetch(`${B}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`, "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call", "Mcp-Name": name,
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 500, method: "tools/call",
      params: {
        name, arguments: args,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  })
  return { status: res.status, wwwAuth: res.headers.get("www-authenticate") ?? "" }
}

console.log("\n[17] GUARDRAIL: scope enforcement (read-only token)")
const narrow = await getToken("memory:read", RESOURCE)
if (narrow.error) ok("read-only token issued", false, narrow.error)
else {
  ok("read-only token issued", true, `scope="${narrow.claims.scope}"`)
  ok("scope really is narrow", narrow.claims.scope === "memory:read", narrow.claims.scope)
  const denied = await callTool(narrow.token, "propose_memory", { fact: "should not land", category: "fact" })
  ok("403 insufficient_scope", denied.status === 403, `status ${denied.status}`)
  ok("challenge names the missing scope", denied.wwwAuth.includes('scope="memory:propose"'), denied.wwwAuth.slice(0, 160))
  const allowed = await callTool(narrow.token, "search_memory", { query: "tabs" })
  ok("but search still works", allowed.status === 200, `status ${allowed.status}`)
}

console.log("\n[18] GUARDRAIL: a token for another audience cannot open /mcp")
const other = await getToken("memory:read", "https://elsewhere.example.com")
if (other.error) {
  // The AS refusing to mint it at all is the stronger outcome.
  ok("AS refused an unlisted audience", true, other.error.slice(0, 120))
} else {
  ok("AS minted it (aud check now matters)", true, `aud=${JSON.stringify(other.claims.aud)}`)
  const wrongAud = await callTool(other.token, "search_memory", { query: "tabs" })
  ok("resource server rejects wrong aud", wrongAud.status === 401, `status ${wrongAud.status}`)
}

console.log("\n[19] session scope becomes available with a thread handle")
const threaded = await fetch(`${B}/mcp`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`, "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": "tools/call", "Mcp-Name": "propose_memory",
  },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 600, method: "tools/call",
    params: {
      name: "propose_memory",
      arguments: { fact: "Is debugging a flaky auth test today", category: "fact", thread: "thread-abc" },
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "1" },
        "io.modelcontextprotocol/clientCapabilities": { elicitation: { form: {}, url: {} } },
      },
    },
  }),
})
const tBody = await threaded.json()
const tUrl = tBody?.result?.inputRequests?.consent?.params?.url ?? ""
const tNeg = tUrl.split("/consent/")[1] ?? ""
const tPage = await j(`${B}/consent/${tNeg}`)
const tHtml = typeof tPage.body === "string" ? tPage.body : ""
ok("session scope now offered", tHtml.includes('value="session"'), tUrl ? "" : JSON.stringify(tBody).slice(0, 200))
ok("global still offered", tHtml.includes('value="global"'))

console.log("\n[20] GUARDRAIL: another user cannot open this consent page (phishing)")
const victimCookie = cookie
cookie = ""
const bob = await j(`${B}/api/auth/sign-up/email`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: `${TAG}-b@example.com`, password: "correct-horse-battery", name: "Bob" }),
})
ok("second user signed up", bob.res.status === 200)
const asBob = await j(`${B}/consent/${tNeg}`)
ok("410 for a different user", asBob.res.status === 410, `status ${asBob.res.status}`)
const bobHtml = typeof asBob.body === "string" ? asBob.body : ""
ok("does not leak the fact", !bobHtml.includes("flaky auth test"))
cookie = victimCookie

console.log("\n[21] Legacy client (no url capability) gets a text link, not an elicitation")
const legacy = await fetch(`${B}/mcp`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`, "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": "tools/call", "Mcp-Name": "propose_memory",
  },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 700, method: "tools/call",
    params: {
      name: "propose_memory",
      arguments: { fact: "Drinks oat milk in coffee", category: "preference" },
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "old-client", version: "1" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  }),
})
const lBody = await legacy.json()
ok("complete, not input_required", lBody?.result?.resultType === "complete", lBody?.result?.resultType)
ok("carries the consent link as text", (lBody?.result?.content?.[0]?.text ?? "").includes("/consent/"), (lBody?.result?.content?.[0]?.text ?? "").slice(0, 120))
ok("no form-mode elicitation offered", !JSON.stringify(lBody).includes('"mode":"form"'))

console.log("\ndone.\n")
