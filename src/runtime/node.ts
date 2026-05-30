import type { Hono } from 'hono'
import type { ServeOptions, ServerHandle } from './types.ts'
import { runShutdown } from './shutdown.ts'

/**
 * Start a Node HTTP server on a Hono app. Requires @hono/node-server to be
 * installed. Returns a handle for graceful shutdown.
 *
 *   const app = createUiApp({ ... })
 *   await serveNode(app, { port: 3000 })
 *
 * Throws if called on a non-Node runtime, or if @hono/node-server isn't
 * installed.
 */
export async function serveNode(app: Hono, options: ServeOptions = {}): Promise<ServerHandle> {
	if (typeof process === 'undefined' || !process.versions?.node) {
		throw new Error('serveNode called but Node runtime not available')
	}

	// Dynamic import so Deno/Workers don't fail to resolve the package
	let serve: typeof import('@hono/node-server').serve
	try {
		; ({ serve } = await import('@hono/node-server'))
	} catch {
		throw new Error(
			'serveNode requires @hono/node-server. Install with: npm install @hono/node-server',
		)
	}

	const port = options.port ?? 3000
	const hostname = options.hostname ?? '0.0.0.0'
	const onListen = options.onListen ?? defaultOnListen
	const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 30000

	const server = serve({ fetch: app.fetch, port, hostname }, () => {
		onListen({ port, hostname })
	})

	const handle: ServerHandle = {
		shutdown(): Promise<void> {
			return new Promise<void>((resolve, reject) => {
				// @ts-ignore — server.close on node http.Server
				server.close(async (err: Error | undefined) => {
					if (err) {
						reject(err)
						return
					}
					try {
						await runShutdown()
						resolve()
					} catch (cleanupErr) {
						reject(cleanupErr)
					}
				})
			})
		},
	}

	registerSignalHandlers(() => handle.shutdown(), shutdownTimeoutMs)

	return handle
}

let signalHandlersRegistered = false

function registerSignalHandlers(handler: () => Promise<void>, timeoutMs: number): void {
	if (signalHandlersRegistered) return
	signalHandlersRegistered = true

	const onSignal = async () => {
		console.log('Received shutdown signal; draining...')

		const timeout = setTimeout(() => {
			console.error(`Shutdown timed out after ${timeoutMs}ms; forcing exit`)
			process.exit(1)
		}, timeoutMs)

		try {
			await handler()
			clearTimeout(timeout)
			console.log('Shutdown complete')
			process.exit(0)
		} catch (err) {
			clearTimeout(timeout)
			console.error('Shutdown failed:', err)
			process.exit(1)
		}
	}

	process.on('SIGTERM', onSignal)
	process.on('SIGINT', onSignal)
}

function defaultOnListen({ port, hostname }: { port: number; hostname: string }): void {
	console.log(`Listening on http://${hostname}:${port}`)
}