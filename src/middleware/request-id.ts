import type { MiddlewareHandler } from 'hono'

export type RequestIdOptions = {
	/** Header name to read from incoming requests and write to responses. */
	header?: string
	/** Generator for IDs when no incoming header is present. */
	generator?: () => string
}

export const REQUEST_ID_KEY = '__hono_ui_request_id'

/**
 * Attach a request ID to every request.
 *
 * If the incoming request has the configured header (default 'X-Request-Id'),
 * uses that value. Otherwise generates a new ID via the configured generator
 * (default: crypto.randomUUID).
 *
 * The ID is:
 *   - available as c.get(REQUEST_ID_KEY) for downstream code
 *   - echoed in the same header on the outbound response
 *
 * Pair with access-log for log correlation across the request lifecycle.
 */
export function requestId(options: RequestIdOptions = {}): MiddlewareHandler {
	const header = options.header ?? 'X-Request-Id'
	const generator = options.generator ?? (() => crypto.randomUUID())

	return async (ctx, next) => {
		const id = ctx.req.header(header) ?? generator()
		ctx.set(REQUEST_ID_KEY, id)
		ctx.header(header, id)
		await next()
	}
}