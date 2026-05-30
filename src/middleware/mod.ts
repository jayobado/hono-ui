/**
 * @module
 * Middleware slot-fillers for hono-ui.
 *
 * Each middleware is a factory function: middleware(options?) → MiddlewareHandler.
 * The createUiApp composer knows the canonical order for these and wires
 * them automatically. Applications fill the slots they want; omitting a slot
 * means that concern is not addressed.
 *
 *   import { requestId, accessLog, errorHandler, cors, bodyLimit }
 *     from '@jayobado/hono-ui/middleware'
 */

export { requestId } from './request-id.ts'
export type { RequestIdOptions } from './request-id.ts'

export { accessLog } from './access-log.ts'
export type { AccessLogOptions, AccessLogEntry } from './access-log.ts'

export { errorHandler } from './error-handler.ts'
export type { ErrorHandlerOptions, ErrorResponse } from './error-handler.ts'

export { cors } from './cors.ts'
export type { CorsOptions } from './cors.ts'

export { bodyLimit } from './body-limit.ts'
export type { BodyLimitOptions } from './body-limit.ts'