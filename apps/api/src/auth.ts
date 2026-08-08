import { oauthProvider } from "@better-auth/oauth-provider"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { jwt } from "better-auth/plugins"

import { createDb } from "./db/client"
import {
  account,
  jwks,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  session,
  user,
  verification,
} from "./db/schema"
import type { Env } from "./env"
import { DAY } from "./lib/time"
import { mcpIssuer, mcpResource, MCP_SCOPES } from "./mcp/config"

/**
 * Built per request rather than once at module scope: Worker isolates receive `env` on the
 * fetch call, so there is no module-level environment to close over. Construction is cheap.
 */
export function createAuth(env: Env, requestOrigin?: string) {
  // Falls back to the request's own origin. On a fresh deploy you do not yet know your
  // workers.dev hostname, and hard-coding one would break the first sign-in.
  const origin = env.BETTER_AUTH_URL || requestOrigin

  return betterAuth({
    baseURL: origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    /**
     * The JWT plugin mounts `POST /api/auth/token`, which mints a bearer JWT for whoever
     * holds the current session cookie. That is a cookie-to-bearer converter, and it would
     * quietly bridge the two planes this system keeps apart: any XSS on the app could mint
     * an agent-shaped token. Nothing here needs it — MCP clients get their tokens from the
     * OAuth authorization-code flow — so the path is removed rather than left unused.
     */
    disabledPaths: ["/token"],
    database: drizzleAdapter(createDb(env.DB), {
      provider: "sqlite",
      schema: {
        user,
        session,
        account,
        verification,
        oauthClient,
        oauthRefreshToken,
        oauthAccessToken,
        oauthConsent,
        jwks,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
    },
    session: {
      expiresIn: (30 * DAY) / 1000,
      updateAge: DAY / 1000,
    },
    /**
     * In development the SPA is served by Vite on :5173 and proxies to the Worker on :8787.
     * Cookies ignore port, so the session cookie set by the Worker is sent back through the
     * proxy — but the Origin header still differs, so both must be trusted.
     *
     * `requestOrigin` is listed unconditionally, and not merely as the fallback `origin` uses.
     * This Worker serves the SPA and the API from one hostname, so a request whose `Origin`
     * equals the origin it was addressed to *is* same-origin by construction — which is exactly
     * what this list exists to recognise. Leaving it out meant every hostname other than
     * BETTER_AUTH_URL (the workers.dev URL, 127.0.0.1 instead of localhost, a LAN address for
     * phone testing) failed sign-in with "Invalid origin". It does not weaken the CSRF check:
     * a page on evil.com still sends `Origin: https://evil.com`, which matches nothing here.
     */
    trustedOrigins: [
      env.WEB_ORIGIN,
      env.BETTER_AUTH_URL,
      origin,
      requestOrigin,
    ].filter((value): value is string => Boolean(value)),
    plugins: [
      /**
       * Signs the access tokens the MCP resource server verifies, and publishes the public
       * half at `/api/auth/jwks`. `issuer` is pinned to the bare origin so that discovery
       * lives at a single root well-known route — see mcp/config.ts for why the two must
       * agree.
       */
      jwt({ jwt: { issuer: origin ? mcpIssuer(origin) : undefined } }),

      oauthProvider({
        loginPage: "/login",
        consentPage: "/oauth/consent",

        /**
         * One scope per agent tool, plus `offline_access` so a long-lived client can
         * refresh without sending the user back through the browser. Note that
         * `offline_access` is deliberately absent from what the resource server advertises
         * in `scopes_supported` — a refresh token is a client convenience, not something
         * the resource requires, and the spec says not to challenge for it.
         */
        scopes: [...MCP_SCOPES, "offline_access"],

        /**
         * The only audience we will ever mint a token for. A token issued for anything
         * else must not open `/mcp`, and a client that omits `resource` gets a token this
         * resource server rejects — which is the correct outcome, not a bug to work around.
         */
        validAudiences: origin ? [mcpResource(origin)] : undefined,

        /**
         * MCP clients and this server have no prior relationship, so a client must be able
         * to register itself. `2026-07-28` prefers Client ID Metadata Documents for this and
         * marks Dynamic Client Registration deprecated-but-valid; Better Auth does not
         * implement CIMD yet, so we offer DCR and do not advertise CIMD support. Clients
         * follow the spec's priority list and fall back here on their own.
         */
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultScopes: [...MCP_SCOPES],

        accessTokenExpiresIn: 60 * 60,
        refreshTokenExpiresIn: 30 * 24 * 60 * 60,

        advertisedMetadata: { scopes_supported: [...MCP_SCOPES] },

        /** Both documents are served at the root by src/index.ts. */
        silenceWarnings: { oauthAuthServerConfig: true, openIdConfig: true },
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
