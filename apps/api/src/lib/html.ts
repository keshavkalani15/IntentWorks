/**
 * Minimal server-rendered pages, for the two consent screens.
 *
 * These are deliberately not React routes in the SPA. Both are opened cold, in a fresh tab,
 * from an external application — often by a user who is not currently looking at the app —
 * and both must decide whether the viewer is allowed to see the page *before* rendering any
 * of its content. A client-side auth check cannot do that: it would ship the fact to the
 * browser and then hide it, and it would lose the path through the SPA's login redirect.
 *
 * Server-rendered HTML with no client framework also means these pages work on the first
 * paint, with no bundle to load and nothing to hydrate.
 */

/** Escape for interpolation into element content or a double-quoted attribute. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const STYLES = `
:root { color-scheme: light dark; --bg:#fbfbfa; --card:#fff; --fg:#1a1a19; --muted:#6b6b68;
  --line:#e6e6e3; --accent:#1a1a19; --accent-fg:#fff; --warn-bg:#fff8e6; --warn-line:#e8d9a8; }
@media (prefers-color-scheme: dark) { :root { --bg:#131313; --card:#1b1b1a; --fg:#f0efec;
  --muted:#9a9a95; --line:#2c2c2a; --accent:#f0efec; --accent-fg:#131313; --warn-bg:#2a2416;
  --warn-line:#4a3f22; } }
* { box-sizing:border-box; }
body { margin:0; min-height:100svh; display:grid; place-items:center; padding:24px;
  background:var(--bg); color:var(--fg);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,sans-serif; }
.card { width:100%; max-width:30rem; background:var(--card); border:1px solid var(--line);
  border-radius:14px; padding:28px; }
h1 { margin:0 0 6px; font-size:1.05rem; font-weight:600; letter-spacing:-0.01em; }
p { margin:0 0 14px; color:var(--muted); }
p.lead { color:var(--fg); }
.fact { margin:16px 0; padding:14px 16px; background:var(--bg); border:1px solid var(--line);
  border-radius:10px; font-size:1rem; }
.who { display:inline-block; padding:2px 8px; border:1px solid var(--line); border-radius:999px;
  font-size:.78rem; color:var(--muted); margin-bottom:14px; }
ul.scopes { list-style:none; margin:0 0 18px; padding:0; }
ul.scopes li { padding:9px 0; border-top:1px solid var(--line); }
ul.scopes li:last-child { border-bottom:1px solid var(--line); }
ul.scopes strong { font-weight:550; display:block; }
ul.scopes span { color:var(--muted); font-size:.87rem; }
fieldset { border:0; margin:0 0 18px; padding:0; }
legend { padding:0 0 8px; font-weight:550; font-size:.9rem; }
label.opt { display:flex; gap:10px; align-items:flex-start; padding:9px 11px; cursor:pointer;
  border:1px solid var(--line); border-radius:9px; margin-bottom:7px; }
label.opt:has(input:checked) { border-color:var(--fg); }
label.opt input { margin:3px 0 0; }
label.opt span { color:var(--muted); font-size:.85rem; display:block; }
.row { display:flex; gap:9px; flex-wrap:wrap; margin-top:4px; }
button, .btn { font:inherit; padding:9px 15px; border-radius:9px; border:1px solid var(--line);
  background:transparent; color:var(--fg); cursor:pointer; text-decoration:none;
  display:inline-block; }
button.primary { background:var(--accent); color:var(--accent-fg); border-color:var(--accent);
  font-weight:550; }
button:disabled { opacity:.5; cursor:default; }
.note { margin-top:16px; font-size:.83rem; color:var(--muted); }
.warn { background:var(--warn-bg); border:1px solid var(--warn-line); border-radius:10px;
  padding:12px 14px; margin:0 0 16px; font-size:.88rem; }
#done { display:none; }
`

export interface PageOptions {
  title: string
  body: string
  status?: number
  /** Inline script, already trusted. Runs after the body. */
  script?: string
}

/**
 * A complete HTML response.
 *
 * `noindex` and `no-store` are not decoration: a consent URL is a one-time capability sent
 * to one person, and neither a crawler nor a shared cache should ever hold a copy.
 */
export function page({
  title,
  body,
  status = 200,
  script,
}: PageOptions): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="robots" content="noindex,nofollow">` +
      `<title>${esc(title)}</title><style>${STYLES}</style></head>` +
      `<body><main class="card">${body}</main>` +
      (script ? `<script>${script}</script>` : "") +
      `</body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    }
  )
}

/** Shown when a consent link is opened by a browser with no session. */
export function signInFirst(origin: string, what: string): Response {
  return page({
    status: 401,
    title: "Sign in to continue",
    body:
      `<h1>Sign in to continue</h1>` +
      `<p class="lead">${esc(what)}</p>` +
      `<p>You need to be signed in to this account before you can approve it. ` +
      `Sign in, then open this link again.</p>` +
      `<div class="row"><a class="btn" href="${esc(origin)}/login">Sign in</a></div>`,
  })
}
