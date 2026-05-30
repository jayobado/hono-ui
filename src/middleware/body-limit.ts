import type { MiddlewareHandler } from 'hono'

export type BodyLimitOptions = {
	/** Maximum allowed body size in bytes. Required — no default. */
	max: number
	/**
	 * Skip the limit for matching requests. Useful for upload endpoints that
	 * have their own size handling.
	 */
	skip?: (c: import('hono').Context) => boolean
	/**
	 * Response when the limit is exceeded. Default: 413 with a small JSON body.
	 */
	onExceeded?: (c: import('hono').Context) => Response | Promise<Response>
}

/**
 * Reject requests with bodies larger than the configured maximum.
 *
 * Required option `max` is in bytes. Applications choose the value because
 * the right limit depends on what your endpoints accept (1KB for an auth
 * form, 50MB for a file upload endpoint, etc.).
 *
 *   bodyLimit: bodyLimit({ max: 1024 * 1024 })   // 1 MB
 *
 * For endpoints that legitimately need larger bodies, use skip:
 *
 *   bodyLimit: bodyLimit({
 *     max: 1024 * 1024,
 *     skip: (c) => c.req.path.startsWith('/uploads/'),
 *   })
 *
 * The check uses Content-Length when present (fast path). Requests without
 * Content-Length (chunked encoding) require reading the body to enforce —
 * the middleware reads up to `max + 1` bytes and rejects if it sees more.
 */
export function bodyLimit(options: BodyLimitOptions): MiddlewareHandler {
	const max = options.max
	const skip = options.skip
	const onExceeded = options.onExceeded ?? defaultOnExceeded

	return async (ctx, next) => {
		if (skip?.(ctx)) {
			await next()
			return
		}

		const contentLength = ctx.req.header('Content-Length')
		if (contentLength) {
			const length = Number(contentLength)
			if (Number.isFinite(length) && length > max) {
				return await onExceeded(ctx)
			}
			// Trust the header — passing through.
			await next()
			return
		}

		// No Content-Length — could be chunked encoding. Read up to max+1 bytes.
		// If we read more, the body is too large.
		const body = ctx.req.raw.body
		if (!body) {
			await next()
			return
		}

		const limited = limitedStream(body, max)
		// Replace the request's body with our limited stream.
		// Hono's ctx.req.raw is read-only, so we construct a new Request.
		const newReq = new Request(ctx.req.url, {
			method: ctx.req.method,
			headers: ctx.req.raw.headers,
			body: limited.stream,
		})
			; (ctx.req as { raw: Request }).raw = newReq

		try {
			await next()
		} catch (error) {
			if (limited.exceeded) {
				return await onExceeded(ctx)
			}
			throw error
		}

		if (limited.exceeded) {
			return await onExceeded(ctx)
		}
	}
}

function defaultOnExceeded(_ctx: import('hono').Context): Response {
	return new Response(
		JSON.stringify({ error: { message: 'Request body too large' } }),
		{ status: 413, headers: { 'Content-Type': 'application/json' } },
	)
}

function limitedStream(
	source: ReadableStream<Uint8Array>,
	max: number,
): { stream: ReadableStream<Uint8Array>; exceeded: boolean } {
	let bytesRead = 0
	const wrapper = { exceeded: false } as { exceeded: boolean; stream: ReadableStream<Uint8Array> }

	const reader = source.getReader()
	wrapper.stream = new ReadableStream({
		async pull(controller) {
			const { done, value } = await reader.read()
			if (done) {
				controller.close()
				return
			}
			bytesRead += value.byteLength
			if (bytesRead > max) {
				wrapper.exceeded = true
				controller.error(new Error('Body too large'))
				return
			}
			controller.enqueue(value)
		},
		cancel(reason) { reader.cancel(reason) },
	})

	return wrapper
}