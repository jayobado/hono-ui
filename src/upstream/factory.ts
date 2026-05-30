import type { Context } from 'hono'
import type { Auth } from '../auth/factory.ts'
import type { BaseSessionData } from '../auth/store.ts'
import { buildHeaders } from './headers.ts'
import { proxyRequest, type ProxyOptions } from './proxy.ts'
import { UpstreamError } from './error.ts'

/**
 * Per-upstream credential mapping. When provided, overrides the auth
 * instance's default credential mapper for this upstream only.
 *
 * Use for backends that share the BFF's auth provider but expect a
 * different credential format (e.g., a different token field on the
 * session, a different header name, signed JWTs, etc.).
 *
 * Receives the current session; returns the headers to attach. The
 * session lookup still goes through `auth`, so token refresh still
 * works — only the format of the outbound headers differs.
 */
export type UpstreamCredentials<S extends BaseSessionData = BaseSessionData> = {
	toHeaders: (session: S) => Record<string, string>
}

export type UpstreamOptions<S extends BaseSessionData = BaseSessionData> = {
	/** Base URL prepended to all paths. e.g., 'https://api.example.com' */
	baseUrl: string
	/**
	 * Auth instance providing the session for credential mapping. If omitted,
	 * this upstream is unauthenticated (only defaultHeaders apply).
	 */
	auth?: Auth<S>
	/**
	 * Per-upstream credential override. When omitted, uses auth's default
	 * credential mapper. When provided, takes precedence over auth's mapper
	 * for this upstream's outbound requests. If `auth` is omitted, this
	 * option does nothing.
	 */
	credentials?: UpstreamCredentials<S>
	/** Default headers sent on every request. */
	defaultHeaders?: Record<string, string>
	/** Request timeout in milliseconds. Default: 30000 (30s). Pass 0 to disable. */
	timeoutMs?: number
}

export type RequestOptions = {
	/** Additional headers for this request. */
	headers?: Record<string, string>
	/**
	 * Override the default timeout. Pass 0 to disable — useful for
	 * streaming endpoints (SSE, long polls, large downloads) where the
	 * connection is expected to stay open.
	 */
	timeoutMs?: number
}

export type Upstream<S extends BaseSessionData = BaseSessionData> = {
	/** Low-level fetch — returns the raw Response. Use for streaming, binary, non-REST protocols. */
	fetch(ctx: Context, path: string, init?: RequestInit & RequestOptions): Promise<Response>

	/** GET request, returns parsed JSON. Throws UpstreamError on non-2xx. */
	get<T = unknown>(ctx: Context, path: string, options?: RequestOptions): Promise<T>

	/** POST request with JSON body, returns parsed JSON. Throws UpstreamError on non-2xx. */
	post<T = unknown>(ctx: Context, path: string, body?: unknown, options?: RequestOptions): Promise<T>

	/** PUT request with JSON body, returns parsed JSON. */
	put<T = unknown>(ctx: Context, path: string, body?: unknown, options?: RequestOptions): Promise<T>

	/** PATCH request with JSON body, returns parsed JSON. */
	patch<T = unknown>(ctx: Context, path: string, body?: unknown, options?: RequestOptions): Promise<T>

	/** DELETE request, returns parsed JSON or undefined for empty responses. */
	delete<T = unknown>(ctx: Context, path: string, options?: RequestOptions): Promise<T>

	/** Build headers without making a request — for use with non-REST clients (Connect, tRPC, etc.). */
	headers(ctx: Context, perRequest?: Record<string, string>): Record<string, string>

	/** Proxy the current inbound request directly to upstream. */
	proxy(ctx: Context, path: string, options?: ProxyOptions): Promise<Response>
}

export function createUpstream<S extends BaseSessionData = BaseSessionData>(
	options: UpstreamOptions<S>,
): Upstream<S> {
	const baseUrl = options.baseUrl.replace(/\/$/, '')   // strip trailing slash
	const defaults = options.defaultHeaders ?? {}
	const auth = options.auth
	const credentialOverride = options.credentials
	const defaultTimeoutMs = options.timeoutMs ?? 30000

	const url = (path: string): string => {
		const cleanPath = path.startsWith('/') ? path : `/${path}`
		return baseUrl + cleanPath
	}

	const headers = (ctx: Context, perRequest?: Record<string, string>): Record<string, string> => {
		return buildHeaders<S>({
			defaults,
			auth: auth ?? null,
			credentialOverride: credentialOverride ?? null,
			ctx,
			perRequest,
		})
	}

	const fetchRaw = async (
		ctx: Context,
		path: string,
		init: RequestInit & RequestOptions = {},
	): Promise<Response> => {
		const targetUrl = url(path)
		const timeoutMs = init.timeoutMs ?? defaultTimeoutMs
		const useTimeout = timeoutMs > 0

		const controller = useTimeout ? new AbortController() : null
		const timer = useTimeout
			? setTimeout(() => controller!.abort(), timeoutMs)
			: null

		const mergedHeaders = headers(ctx, init.headers as Record<string, string> | undefined)

		try {
			const response = await fetch(targetUrl, {
				...init,
				headers: mergedHeaders,
				signal: init.signal ?? controller?.signal,
			})
			return response
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				throw new UpstreamError(`Request timed out after ${timeoutMs}ms`, {
					url: targetUrl,
					method: init.method ?? 'GET',
					cause: err,
				})
			}
			throw new UpstreamError(`Upstream fetch failed: ${targetUrl}`, {
				url: targetUrl,
				method: init.method ?? 'GET',
				cause: err,
			})
		} finally {
			if (timer) clearTimeout(timer)
		}
	}

	const jsonRequest = async <T>(
		ctx: Context,
		method: string,
		path: string,
		body: unknown,
		requestOptions: RequestOptions = {},
	): Promise<T> => {
		const init: RequestInit & RequestOptions = {
			method,
			headers: {
				...(body !== undefined && { 'Content-Type': 'application/json' }),
				...requestOptions.headers,
			},
			...(body !== undefined && { body: JSON.stringify(body) }),
			timeoutMs: requestOptions.timeoutMs,
		}

		const response = await fetchRaw(ctx, path, init)

		if (!response.ok) {
			let errorBody: unknown
			try {
				errorBody = await response.json()
			} catch {
				try {
					errorBody = await response.text()
				} catch {
					errorBody = undefined
				}
			}
			throw new UpstreamError(
				`Upstream returned ${response.status}: ${method} ${path}`,
				{
					status: response.status,
					url: url(path),
					method,
					body: errorBody,
				},
			)
		}

		// 204 No Content or empty body
		if (response.status === 204 || response.headers.get('Content-Length') === '0') {
			return undefined as T
		}

		return await response.json() as T
	}

	return {
		fetch: fetchRaw,

		get: <T>(ctx: Context, path: string, options?: RequestOptions) =>
			jsonRequest<T>(ctx, 'GET', path, undefined, options),

		post: <T>(ctx: Context, path: string, body?: unknown, options?: RequestOptions) =>
			jsonRequest<T>(ctx, 'POST', path, body, options),

		put: <T>(ctx: Context, path: string, body?: unknown, options?: RequestOptions) =>
			jsonRequest<T>(ctx, 'PUT', path, body, options),

		patch: <T>(ctx: Context, path: string, body?: unknown, options?: RequestOptions) =>
			jsonRequest<T>(ctx, 'PATCH', path, body, options),

		delete: <T>(ctx: Context, path: string, options?: RequestOptions) =>
			jsonRequest<T>(ctx, 'DELETE', path, undefined, options),

		headers,

		proxy: (ctx: Context, path: string, options?: ProxyOptions) =>
			proxyRequest(ctx, url(path), options, headers(ctx)),
	}
}