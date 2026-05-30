import type { Hono } from 'hono'

export type HealthOptions = {
	/**
	 * Path prefix for health endpoints. Default: ''.
	 * Use to mount under a sub-path (e.g., '/internal' → '/internal/health').
	 */
	prefix?: string

	/**
	 * Version metadata returned by /version. All fields optional but at least
	 * one should be set for the endpoint to be meaningful.
	 */
	version?: string
	commit?: string
	builtAt?: string

	/**
	 * Readiness check. Should return true if the process is ready to serve
	 * traffic (downstream dependencies reachable, etc.). Should complete
	 * quickly — orchestrators poll /ready aggressively.
	 *
	 * Default: always ready (returns 200).
	 *
	 * If the check throws or returns false, /ready returns 503.
	 */
	ready?: () => boolean | Promise<boolean>
}

/**
 * Mount conventional health endpoints on a Hono app.
 *
 *   GET /health   → 200 if the process is alive (always returns 200)
 *   GET /ready    → 200 if the process can serve traffic, 503 otherwise
 *   GET /version  → 200 with build metadata
 *
 * The /health and /ready split matters: /health is for "is the process
 * running?", /ready is for "should this instance receive traffic?". A
 * deadlocked or dependency-starved instance can be alive but not ready.
 */
export function mountHealth(app: Hono, options: HealthOptions = {}): void {
	const prefix = options.prefix ?? ''
	const ready = options.ready

	// /health — liveness
	app.get(`${prefix}/health`, (c) =>
		c.json({ status: 'ok' }),
	)

	// /ready — readiness
	app.get(`${prefix}/ready`, async (c) => {
		if (!ready) {
			return c.json({ status: 'ok' })
		}
		try {
			const isReady = await ready()
			if (isReady) {
				return c.json({ status: 'ok' })
			}
			return c.json({ status: 'not_ready' }, 503)
		} catch (err) {
			return c.json(
				{
					status: 'not_ready',
					error: err instanceof Error ? err.message : String(err),
				},
				503,
			)
		}
	})

	// /version — build metadata
	app.get(`${prefix}/version`, (c) =>
		c.json({
			version: options.version,
			commit: options.commit,
			builtAt: options.builtAt,
		}),
	)
}