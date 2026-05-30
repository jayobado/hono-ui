/**
 * @module
 * Runtime helpers for serving Hono apps on Deno and Node.
 *
 *   import { serveDeno, onShutdown } from '@jayobado/hono-ui/runtime'
 *
 *   const app = createUiApp({ ... })
 *   onShutdown(async () => { await db.close() })
 *   await serveDeno(app, { port: 3000 })
 *
 * serveDeno and serveNode each throw if called on the wrong runtime.
 * Import only the one your runtime needs:
 *
 *   import { serveDeno } from '@jayobado/hono-ui/runtime/deno'   // Deno only
 *   import { serveNode } from '@jayobado/hono-ui/runtime/node'   // Node only
 *
 * Or use the top-level barrel above — only the runtime-appropriate function
 * will actually run; the other will throw if called.
 */

export { serveDeno } from './deno.ts'
export { serveNode } from './node.ts'
export { onShutdown, runShutdown } from './shutdown.ts'
export type { ServeOptions, ServerHandle } from './types.ts'