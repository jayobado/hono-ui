// src/mod.ts

/**
 * @module
 * A toolkit for composing Hono applications from kit primitives.
 *
 *   import { createApp } from '@jayobado/hono-ui'
 *   import { requestId, accessLog, errorHandler, cors, bodyLimit }
 *     from '@jayobado/hono-ui/middleware'
 *   import { createAuth } from '@jayobado/hono-ui/auth'
 *   import { createInertiaApp } from '@jayobado/hono-ui/inertia'
 *   import { createRoutes } from '@jayobado/hono-ui/route'
 *   import { createUpstream } from '@jayobado/hono-ui/upstream'
 *   import { serveDeno } from '@jayobado/hono-ui/runtime'
 *
 *   const app = createApp({ ... })
 *   await serveDeno(app, { port: 3000 })
 */

export { createApp } from './factory.ts'
export type { AppConfig } from './factory.ts'

export { mountHealth } from './health.ts'
export type { HealthOptions } from './health.ts'