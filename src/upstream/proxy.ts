import type { Context } from 'hono'
import { UpstreamError } from './error.ts'

export type ProxyOptions = {
	/**
	 * Headers from the inbound request to NOT forward to upstream.
	 * Defaults to ['cookie'] which strips ALL cookies — the BFF's session
	 * cookie should not reach upstream. Use credentials.forwardCookies to
	 * round-trip specific cookies deliberately.
	 */
	stripHeaders?: string[]
	/** Additional headers to set on the proxied request. */
	setHeaders?: Record<string, string>
}

/**
 * Forward the current inbound request to an upstream URL, returning the
 * upstream's response directly.
 *
 * Used when the BFF is a thin pass-through for a route — useful for legacy
 * endpoints or when you want a route to stream through to upstream without
 * BFF logic intervening. Most BFF routes should NOT use this; they should
 * use upstream.get/post/etc. to build deliberate requests.
 *
 * Cookies are stripped by default (the inbound has the BFF's session
 * cookie, which upstream shouldn't see).
 */
export async function proxyRequest(
	ctx: Context,
	targetUrl: string,
	options: ProxyOptions = {},
	baseHeaders: Record<string, string> = {},
): Promise<Response> {
	const strip = new Set((options.stripHeaders ?? ['cookie']).map((h) => h.toLowerCase()))

	const forwardedHeaders: Record<string, string> = { ...baseHeaders }

	// Copy inbound headers that aren't stripped
	for (const [key, value] of ctx.req.raw.headers.entries()) {
		if (!strip.has(key.toLowerCase())) {
			forwardedHeaders[key] = value
		}
	}

	// Override with explicit setHeaders
	if (options.setHeaders) {
		for (const [k, v] of Object.entries(options.setHeaders)) {
			forwardedHeaders[k] = v
		}
	}

	const method = ctx.req.method
	const body = method === 'GET' || method === 'HEAD' ? undefined : ctx.req.raw.body

	type FetchInit = RequestInit & { duplex?: 'half' | 'full' }

	try {
		return await fetch(targetUrl, {
			method,
			headers: forwardedHeaders,
			body,
			// duplex required for streaming bodies on Node 18+; not in the standard
			// RequestInit type yet, so we widen via unknown.
			...(body ? { duplex: 'half' as const } : {}),
		} satisfies FetchInit)
	} catch (err) {
		throw new UpstreamError(`Proxy fetch failed: ${targetUrl}`, {
			url: targetUrl,
			method,
			cause: err,
		})
	}
}