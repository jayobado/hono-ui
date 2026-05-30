import type { Context, MiddlewareHandler } from 'hono'

export type ErrorResponse = {
	error: {
		message: string
		code?: string
		requestId?: string
	}
}

export type ErrorHandlerOptions = {
	/**
	 * Called when an unhandled error is caught. Use this to ship the error
	 * to your observability stack (Sentry, etc.) before the response is
	 * produced. The middleware still produces the response; this is for
	 * side-effecty reporting.
	 */
	onError?: (error: unknown, c: Context) => void | Promise<void>
	/**
	 * Convert any thrown value into an HTTP response. Default produces a
	 * generic 500 with a sanitized message. Provide your own to map specific
	 * error classes to specific statuses.
	 */
	toResponse?: (error: unknown, c: Context) => Response | Promise<Response>
}

/**
 * Catch unhandled errors thrown from route handlers and downstream middleware,
 * producing a consistent error response shape.
 *
 * Place this near the top of the middleware chain (after request-id, before
 * everything else) so all errors below it are caught. The composer in
 * createUiApp handles this ordering automatically.
 *
 * The default response body is { error: { message, requestId } } with status
 * derived from the error if it has one (Hono's HTTPException, fetch's
 * Response, anything with a numeric .status), otherwise 500.
 *
 * Production apps almost always provide a custom toResponse to map domain
 * errors to user-friendly messages.
 */
export function errorHandler(options: ErrorHandlerOptions = {}): MiddlewareHandler {
	const onError = options.onError
	const toResponse = options.toResponse ?? defaultToResponse

	return async (ctx, next) => {
		try {
			await next()
		} catch (error) {
			if (onError) {
				try { await onError(error, ctx) } catch { /* swallow */ }
			}
			ctx.res = await toResponse(error, ctx)
		}
	}
}

function defaultToResponse(error: unknown, ctx: Context): Response {
	const status = extractStatus(error) ?? 500
	const message = status >= 500
		? 'Internal server error'
		: (error instanceof Error ? error.message : 'Request failed')

	const body: ErrorResponse = {
		error: {
			message,
			requestId: ctx.get('requestId'),
		},
	}

	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

function extractStatus(error: unknown): number | undefined {
	if (typeof error === 'object' && error !== null) {
		const status = (error as { status?: unknown }).status
		if (typeof status === 'number' && status >= 400 && status < 600) {
			return status
		}
	}
	return undefined
}