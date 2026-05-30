import type { MiddlewareHandler, Context } from 'hono'

export type AccessLogEntry = {
	requestId: string | undefined
	method: string
	path: string
	status: number
	durationMs: number
	userAgent: string | undefined
}

export type AccessLogOptions = {
	/** Sink for log entries. Default: console.log with JSON stringify. */
	log?: (entry: AccessLogEntry) => void
	/** Skip logging for matching paths (e.g., health checks). */
	skip?: (c: Context) => boolean
}

/**
 * Log every request with method, path, status, duration, and request ID.
 *
 * The application provides the log sink — by default writes to console as
 * JSON, but production apps typically pipe to a structured logger (pino,
 * slog, etc.) by passing log: (entry) => logger.info(entry).
 *
 * Skip lets you filter out high-volume / low-value paths like /health,
 * which would otherwise dominate your logs.
 */
export function accessLog(options: AccessLogOptions = {}): MiddlewareHandler {
	const log = options.log ?? ((entry) => console.log(JSON.stringify(entry)))
	const skip = options.skip

	return async (ctx, next) => {
		if (skip?.(ctx)) {
			await next()
			return
		}

		const start = performance.now()
		await next()
		const durationMs = performance.now() - start

		log({
			requestId: ctx.get('requestId'),
			method: ctx.req.method,
			path: new URL(ctx.req.url).pathname,
			status: ctx.res.status,
			durationMs: Math.round(durationMs * 100) / 100,
			userAgent: ctx.req.header('User-Agent'),
		})
	}
}