import type { Context } from 'hono'
import type { Auth } from '../auth/factory.ts'
import type { BaseSessionData } from '../auth/store.ts'
import type { UpstreamCredentials } from './factory.ts'

/**
 * Build the header set for an outbound upstream request.
 *
 * Layers, in increasing precedence:
 *   1. Static default headers from createUpstream config
 *   2. Credential headers — from credentialOverride if provided,
 *      otherwise from auth's default credential relay
 *   3. Forwarded cookies (from auth's credential relay, if any are
 *      configured to forward — this is auth-level, not per-upstream)
 *   4. Per-request headers passed to the call
 *
 * Later layers override earlier ones.
 *
 * Credential resolution rules:
 *   - No auth → no credentials from session (only defaults + per-request)
 *   - auth present, no override → use auth.credentials.toHeaders (if any)
 *   - auth present, override present → use override.toHeaders
 */
export function buildHeaders<S extends BaseSessionData>(args: {
	defaults: Record<string, string>
	auth: Auth<S> | null
	credentialOverride: UpstreamCredentials<S> | null
	ctx: Context
	perRequest: Record<string, string> | undefined
}): Record<string, string> {
	const out: Record<string, string> = { ...args.defaults }

	if (args.auth) {
		const session = args.auth.getSession(args.ctx)

		if (session) {
			// Credential headers — override takes precedence over auth's default mapper
			const credentialHeaders = args.credentialOverride
				? args.credentialOverride.toHeaders(session)
				: args.auth.credentials?.headersFor(session) ?? {}

			for (const [k, v] of Object.entries(credentialHeaders)) {
				out[k] = v
			}

			// Forwarded cookies — auth-level concern, not per-upstream
			if (args.auth.credentials) {
				const forwarded = args.auth.credentials.forwardedCookies(args.ctx)
				if (forwarded) {
					out['Cookie'] = forwarded
				}
			}
		}
	}

	if (args.perRequest) {
		for (const [k, v] of Object.entries(args.perRequest)) {
			out[k] = v
		}
	}

	return out
}