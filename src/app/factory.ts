import { Hono, type MiddlewareHandler } from 'hono'
import type { Auth, BaseSessionData } from '../auth/mod.ts'
import type { InertiaInstance } from '../inertia/mod.ts'
import type { Routes } from '../route/mod.ts'
import { mountHealth, type HealthOptions } from '../health/mod.ts'

/**
 * Configuration for createApp.
 *
 * The composer wires middleware in canonical order:
 *
 *   requestId → errorHandler → accessLog → cors → bodyLimit → custom
 *     → health → auth → inertia → routes
 *
 * Each slot is optional. Only configured slots are mounted. The order is
 * fixed by the kit; applications fill values, not positions.
 *
 * Custom middleware runs after lifecycle slots but before auth, so most
 * application middleware sees requests before authentication. For
 * post-auth middleware, attach it to the returned Hono app directly:
 *
 *   const app = createApp({ ... })
 *   app.use('*', myPostAuthMiddleware())
 */
export type AppConfig<S extends BaseSessionData = BaseSessionData> = {
	middleware?: {
		requestId?: MiddlewareHandler
		accessLog?: MiddlewareHandler
		errorHandler?: MiddlewareHandler
		cors?: MiddlewareHandler
		bodyLimit?: MiddlewareHandler
		custom?: MiddlewareHandler[]
	}
	auth?: Auth<S>
	inertia?: InertiaInstance
	routes?: Routes
	routesPrefix?: string
	health?: HealthOptions
}

/**
 * Compose a Hono app from kit primitives.
 *
 * The composer's value is canonical middleware ordering and slot-based
 * configuration. Applications fill the slots they want; the kit decides
 * where each fits in the request lifecycle.
 *
 *   const app = createApp({
 *     middleware: {
 *       requestId: requestId(),
 *       accessLog: accessLog(),
 *       errorHandler: errorHandler(),
 *       cors: cors({ origins: ['https://app.example.com'] }),
 *       bodyLimit: bodyLimit({ max: 1024 * 1024 }),
 *     },
 *     auth,
 *     inertia,
 *     routes,
 *     health: { version: '1.0.0' },
 *   })
 *
 *   await serveDeno(app, { port: 3000 })
 *
 * Returns the underlying Hono app. Applications can attach further
 * routes, middleware, or static serving after composition if needed:
 *
 *   app.use('/assets/*', serveStatic({ root: './dist' }))
 */
export function createApp<S extends BaseSessionData = BaseSessionData>(config: AppConfig<S>): Hono {
	const app = new Hono()
	const mw = config.middleware ?? {}

	// 1. Lifecycle middleware — canonical order
	if (mw.requestId) app.use('*', mw.requestId)
	if (mw.errorHandler) app.use('*', mw.errorHandler)
	if (mw.accessLog) app.use('*', mw.accessLog)
	if (mw.cors) app.use('*', mw.cors)
	if (mw.bodyLimit) app.use('*', mw.bodyLimit)

	// 2. Custom middleware — application order, runs before auth
	for (const m of mw.custom ?? []) {
		app.use('*', m)
	}

	// 3. Health endpoints — before auth so they bypass session reads
	if (config.health) {
		mountHealth(app, config.health)
	}

	// 4. Auth middleware — loads session, refreshes if needed
	if (config.auth) {
		app.use('*', config.auth.middleware)
	}

	// 5. Inertia middleware — errors + shared bag setup
	if (config.inertia) {
		app.use('*', config.inertia.middleware)
	}

	// 6. Routes — the application's route table
	if (config.routes) {
		app.route(config.routesPrefix ?? '/', config.routes.build())
	}

	return app
}