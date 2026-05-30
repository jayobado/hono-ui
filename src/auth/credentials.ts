import type { Context } from 'hono'
import type { BaseSessionData } from './store.ts'

export type CredentialOptions<S extends BaseSessionData = BaseSessionData> = {
	/**
	 * Convert a session into the headers that should ride on upstream
	 * requests. Most apps return { Authorization: `Bearer ${session.accessToken}` },
	 * but the shape is yours.
	 */
	toHeaders: (session: S) => Record<string, string>

	/**
	 * Optional cookies to forward to upstream alongside the credential header.
	 * For example, a session-affinity cookie set by the upstream that the BFF
	 * should round-trip back. Default: no cookies forwarded.
	 */
	forwardCookies?: string[]
}

/**
 * Bound credential relay. Returned from createAuth.
 *
 * Used by createUpstream's middleware to attach credentials to outbound
 * requests for the current authenticated user. Also accessible to
 * application code that wants to make ad-hoc upstream calls.
 */
export function createCredentialRelay<S extends BaseSessionData>(options: CredentialOptions<S>) {
	return {
		/**
		 * Get the credential headers for the current session. Returns null if
		 * no session is present (caller decides what to do — usually 401).
		 */
		headersFor(session: S): Record<string, string> {
			return options.toHeaders(session)
		},

		/**
		 * Extract cookies that should be forwarded to upstream, from the
		 * incoming request. Returns a Cookie header value or null.
		 */
		forwardedCookies(ctx: Context): string | null {
			const names = options.forwardCookies
			if (!names || names.length === 0) return null

			const cookieHeader = ctx.req.header('Cookie')
			if (!cookieHeader) return null

			const wanted = new Set(names)
			const kept: string[] = []
			for (const pair of cookieHeader.split(';').map((s) => s.trim())) {
				const eq = pair.indexOf('=')
				if (eq < 0) continue
				const cookieName = pair.slice(0, eq).trim()
				if (wanted.has(cookieName)) kept.push(pair)
			}
			return kept.length > 0 ? kept.join('; ') : null
		},
	}
}

export type CredentialRelay<S extends BaseSessionData = BaseSessionData> =
	ReturnType<typeof createCredentialRelay<S>>