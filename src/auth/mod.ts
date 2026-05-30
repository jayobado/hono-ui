/**
 * @module
 * BFF auth for hono-ui. OAuth-refresh-shaped: session in cookie, access +
 * refresh tokens in store, credentials relayed to upstream services.
 *
 *   import { createAuth, createMemoryStore } from '@jayobado/hono-ui/auth'
 *
 *   const auth = createAuth({
 *     store: createMemoryStore(),
 *     cookie: { secure: true, sameSite: 'Lax' },
 *     credentials: { toHeaders: (s) => ({ Authorization: `Bearer ${s.accessToken}` }) },
 *     refresh: { refresh: (token) => fetchNewToken(token) },
 *   })
 *
 * For Cloudflare KV / Durable Object stores, see @jayobado/hono-ui/cloudflare.
 */

export { createAuth } from './factory.ts'
export type { Auth, AuthOptions } from './factory.ts'

export { createMemoryStore } from './memory.ts'
export type { SessionStore, BaseSessionData } from './store.ts'

export type { CookieOptions } from './cookie.ts'
export type { CredentialOptions, CredentialRelay } from './credentials.ts'
export type { RefreshOptions, RefreshResult, RefreshRunner } from './refresh.ts'