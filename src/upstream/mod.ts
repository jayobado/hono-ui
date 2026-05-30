/**
 * @module
 * Upstream HTTP client for hono-ui. Composes with auth's credential relay
 * to attach Authorization headers to outbound requests automatically.
 *
 * Per-upstream credential overrides let you target backends that share the
 * BFF's auth provider but expect a different credential format.
 *
 *   import { createUpstream } from '@jayobado/hono-ui/upstream'
 *
 *   const api = createUpstream({
 *     baseUrl: 'https://api.example.com',
 *     auth,
 *     defaultHeaders: { Accept: 'application/json' },
 *     timeoutMs: 10000,
 *   })
 *
 *   // REST convenience:
 *   const orders = await api.get<Order[]>(c, '/orders')
 *
 *   // Streaming / non-REST — use fetch directly:
 *   const stream = await api.fetch(c, '/events', { timeoutMs: 0 })
 *
 *   // Non-REST protocols (Connect, tRPC, GraphQL, JSON-RPC) — use the
 *   // headers builder with the protocol's canonical client. See README.
 */

export { createUpstream } from './factory.ts'
export type {
	Upstream,
	UpstreamOptions,
	UpstreamCredentials,
	RequestOptions,
} from './factory.ts'

export { UpstreamError } from './error.ts'
export type { ProxyOptions } from './proxy.ts'