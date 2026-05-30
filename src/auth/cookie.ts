import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

export type CookieOptions = {
	/** Cookie name. Default: 'sid'. */
	name?: string
	/** Domain scope. Omit for browser-default (request host). */
	domain?: string
	/** Path scope. Default: '/'. */
	path?: string
	/** Same-site policy. Default: 'Lax'. */
	sameSite?: 'Strict' | 'Lax' | 'None'
	/** Require HTTPS. Default: true. */
	secure?: boolean
	/** Max-age in seconds. Default: 7 days. */
	maxAge?: number
}

const DEFAULTS: Required<Omit<CookieOptions, 'domain'>> = {
	name: 'sid',
	path: '/',
	sameSite: 'Lax',
	secure: true,
	maxAge: 60 * 60 * 24 * 7,
}

/**
 * Cookie I/O bound to a configuration. Returned from createAuth and used
 * internally; applications don't typically construct this directly.
 */
export function createCookieIO(options: CookieOptions = {}) {
	const cfg = { ...DEFAULTS, ...options }
	const { name, domain, path, sameSite, secure, maxAge } = cfg

	return {
		read(ctx: Context): string | undefined {
			return getCookie(ctx, name)
		},

		write(ctx: Context, sessionId: string): void {
			setCookie(ctx, name, sessionId, {
				httpOnly: true,
				secure,
				sameSite,
				path,
				domain,
				maxAge,
			})
		},

		clear(ctx: Context): void {
			deleteCookie(ctx, name, { path, domain })
		},
	}
}

export type CookieIO = ReturnType<typeof createCookieIO>