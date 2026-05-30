import type { Context, MiddlewareHandler } from 'hono'
import type { PropValue } from './page.ts'

/**
 * A SharedProvider is a function called once per request when a page resolves.
 * Returns props that get merged into every page from this app.
 *
 * Registered once at app construction; runs on every resolution. Equivalent to
 * Laravel's HandleInertiaRequests::share() method.
 */
export type SharedProvider = (c: Context) => Record<string, PropValue> | Promise<Record<string, PropValue>>

/**
 * Per-request bag: anything written here during the request lifecycle gets
 * merged into the page on resolve. Equivalent to Laravel's Inertia::share()
 * facade call mid-request.
 *
 * Lives in c.set(SHARED_BAG_KEY, ...) so it's request-scoped automatically.
 */
type SharedBag = Record<string, PropValue>

export const SHARED_BAG_KEY = '__hono_ui_inertia_shared'

/**
 * Initialize the per-request bag. Run as the first middleware so any later
 * code can call share(c, key, value) without checking if the bag exists.
 */
export function sharedMiddleware(): MiddlewareHandler {
	return async (ctx, next) => {
		ctx.set(SHARED_BAG_KEY, {})
		await next()
	}
}

/**
 * Resolve all shared data for the current request. Called once by the
 * resolver in Step 3, in this order:
 *
 *   1. static providers (auth, flash, csrf — the always-on stuff)
 *   2. per-request bag (anything share() pushed mid-request)
 *
 * Later entries win, so a controller's share() can override a static
 * provider — matches Laravel's behavior.
 */
export async function resolveShared(
	ctx: Context,
	providers: SharedProvider[],
): Promise<Record<string, PropValue>> {
	const merged: Record<string, PropValue> = {}

	for (const provider of providers) {
		const result = await provider(ctx)
		Object.assign(merged, result)
	}

	const bag = ctx.get(SHARED_BAG_KEY) as SharedBag | undefined
	Object.assign(merged, bag)

	return merged
}