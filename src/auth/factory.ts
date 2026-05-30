import type { Context, MiddlewareHandler } from 'hono'
import type { BaseSessionData, SessionStore } from './store.ts'
import { createCookieIO, type CookieOptions, type CookieIO } from './cookie.ts'
import { createCredentialRelay, type CredentialOptions, type CredentialRelay } from './credentials.ts'
import { createRefreshRunner, type RefreshOptions, type RefreshRunner } from './refresh.ts'

export type AuthOptions<S extends BaseSessionData = BaseSessionData> = {
	store: SessionStore<S>
	cookie?: CookieOptions
	credentials?: CredentialOptions<S>
	refresh?: RefreshOptions
	/**
	 * Optional hook called after every session read. Useful for "extend
	 * session on activity" semantics. Receives the session; return value
	 * is ignored.
	 */
	onSessionRead?: (ctx: Context, session: S) => void | Promise<void>
}

export type Auth<S extends BaseSessionData = BaseSessionData> = {
	middleware: MiddlewareHandler

	/**
	 * Create a new session and write the cookie. Returns the session ID.
	 * Use after successful authentication.
	 */
	login(ctx: Context, data: S): Promise<string>

	/**
	 * Delete the current session and clear the cookie.
	 */
	logout(ctx: Context): Promise<void>

	/**
	 * Get the current session, refreshing if needed. Returns null if no
	 * session is present or it can't be refreshed.
	 */
	getSession(ctx: Context): S | null 

	/**
	 * Guard middleware: blocks requests without a session. Returns 401 by
	 * default; pass redirect URL for an HTML-friendly auth wall.
	 */
	require(options?: { redirectTo?: string }): MiddlewareHandler

	/** Cookie I/O bound to this auth instance. */
	cookie: CookieIO

	/** Credential relay, if configured. */
	credentials: CredentialRelay<S> | null

	/** Refresh runner, if configured. */
	refresh: RefreshRunner | null
}

const SESSION_KEY = '__hono_ui_session'

export function createAuth<S extends BaseSessionData = BaseSessionData>(
	options: AuthOptions<S>,
): Auth<S> {
	const cookie = createCookieIO(options.cookie)
	const credentials = options.credentials ? createCredentialRelay(options.credentials) : null
	const refresh = options.refresh ? createRefreshRunner(options.refresh) : null

	// ─── Middleware: read session and attach to context ──────────────────
	const middleware: MiddlewareHandler = async (ctx, next) => {
		const sessionId = cookie.read(ctx)
		if (!sessionId) {
			ctx.set(SESSION_KEY, null)
			await next()
			return
		}

		let session = await options.store.get(sessionId)
		if (!session) {
			ctx.set(SESSION_KEY, null)
			cookie.clear(ctx)
			await next()
			return
		}

		// Refresh if needed
		if (refresh && refresh.shouldRefresh(session)) {
			const refreshed = await refresh.run(session)
			if (refreshed) {
				// refresh.run returns BaseSessionData (it only touches token fields).
				// Cast back to S — safe because run() does {...session, ...newTokens},
				// preserving all S-specific fields untouched.
				const typed = refreshed as S
				await options.store.set(sessionId, typed)
				session = typed
			} else {
				// Refresh failed — kill the session
				await options.store.delete(sessionId)
				cookie.clear(ctx)
				ctx.set(SESSION_KEY, null)
				await next()
				return
			}
		}
		// Optional hook
		if (options.onSessionRead) {
			try { await options.onSessionRead(ctx, session) } catch { /* swallow */ }
		}

		ctx.set(SESSION_KEY, session)
		await next()
	}

	// ─── login ────────────────────────────────────────────────────────────
	const login = async (ctx: Context, data: S): Promise<string> => {
		const sessionId = crypto.randomUUID()
		await options.store.set(sessionId, data)
		cookie.write(ctx, sessionId)
		return sessionId
	}

	// ─── logout ───────────────────────────────────────────────────────────
	const logout = async (ctx: Context): Promise<void> => {
		const sessionId = cookie.read(ctx)
		if (sessionId) await options.store.delete(sessionId)
		cookie.clear(ctx)
		ctx.set(SESSION_KEY, null)
	}

	// ─── getSession ───────────────────────────────────────────────────────
	const getSession = (ctx: Context): S | null => {
		return (ctx.get(SESSION_KEY) as S | null) ?? null
	}

	// ─── require (guard middleware) ───────────────────────────────────────
	const require = (opts: { redirectTo?: string } = {}): MiddlewareHandler => {
		return async (ctx, next) => {
			const session = ctx.get(SESSION_KEY)
			if (session) {
				await next()
				return
			}
			if (opts.redirectTo) {
				return new Response(null, { status: 302, headers: { Location: opts.redirectTo } })
			}
			return new Response(
				JSON.stringify({ error: { message: 'Unauthorized' } }),
				{ status: 401, headers: { 'Content-Type': 'application/json' } },
			)
		}
	}

	return { middleware, login, logout, getSession, require, cookie, credentials, refresh }
}