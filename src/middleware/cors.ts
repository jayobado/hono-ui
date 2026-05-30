import type { MiddlewareHandler } from 'hono'

export type CorsOptions = {
	/**
	 * Allowed origins. Either an explicit list or a predicate.
	 * Required — no default, because '*' is a security decision.
	 */
	origins: string[] | ((origin: string) => boolean)
	/** Methods to allow on preflight. Default: GET, POST, PUT, PATCH, DELETE, OPTIONS. */
	methods?: string[]
	/** Headers the browser may send. */
	headers?: string[]
	/** Whether credentials (cookies, auth headers) may be sent cross-origin. */
	credentials?: boolean
	/** Max-age for preflight caching in seconds. */
	maxAge?: number
	/** Headers to expose to the browser beyond the simple set. */
	exposeHeaders?: string[]
}

/**
 * CORS middleware. Applications MUST specify origins — there is no default,
 * because the right value depends on your deployment shape and getting it
 * wrong has security implications.
 *
 * For SPA apps where the API is same-origin, you don't need CORS. Drop the
 * slot in createUiApp's middleware config.
 *
 * For BFFs serving a separate frontend domain:
 *
 *   cors: cors({ origins: ['https://app.example.com'], credentials: true })
 *
 * For development with localhost variations, pass a predicate:
 *
 *   cors: cors({
 *     origins: (o) => o.startsWith('http://localhost:') || o === 'https://app.example.com',
 *     credentials: true,
 *   })
 */
export function cors(options: CorsOptions): MiddlewareHandler {
	const isAllowed = typeof options.origins === 'function'
		? options.origins
		: (origin: string) => options.origins as string[]
			? (options.origins as string[]).includes(origin)
			: false

	const methods = (options.methods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).join(', ')
	const headers = options.headers?.join(', ')
	const exposeHeaders = options.exposeHeaders?.join(', ')
	const credentials = options.credentials === true
	const maxAge = options.maxAge

	return async (ctx, next) => {
		const origin = ctx.req.header('Origin')
		if (!origin) {
			await next()
			return
		}

		if (!isAllowed(origin)) {
			// Don't reflect; the browser will block the request.
			await next()
			return
		}

		// Headers common to preflight and actual requests
		ctx.header('Access-Control-Allow-Origin', origin)
		ctx.header('Vary', 'Origin')
		if (credentials) ctx.header('Access-Control-Allow-Credentials', 'true')
		if (exposeHeaders) ctx.header('Access-Control-Expose-Headers', exposeHeaders)

		if (ctx.req.method === 'OPTIONS') {
			// Preflight — respond directly, don't continue
			ctx.header('Access-Control-Allow-Methods', methods)
			if (headers) ctx.header('Access-Control-Allow-Headers', headers)
			else {
				const reqHeaders = ctx.req.header('Access-Control-Request-Headers')
				if (reqHeaders) ctx.header('Access-Control-Allow-Headers', reqHeaders)
			}
			if (maxAge !== undefined) ctx.header('Access-Control-Max-Age', String(maxAge))
			return new Response(null, { status: 204 })
		}

		await next()
	}
}