// src/runtime/deno.ts

import type { Hono } from 'hono'
import type { ServeOptions, ServerHandle } from './types.ts'
import { runShutdown } from './shutdown.ts'

/**
 * Start a Deno HTTP server on a Hono app. Returns a handle for graceful
 * shutdown. Registers SIGTERM/SIGINT handlers that call the handle's
 * shutdown and run any registered cleanup callbacks.
 *
 *   const app = createUiApp({ ... })
 *   await serveDeno(app, { port: 3000 })
 *
 * Throws if called on a non-Deno runtime.
 */
export function serveDeno(app: Hono, options: ServeOptions = {}): Promise<ServerHandle> {
	// @ts-ignore — Deno globals not in standard lib.dom.d.ts
	if (typeof Deno === 'undefined') {
		throw new Error('serveDeno called but Deno runtime not available')
	}

	const port = options.port ?? 3000
	const hostname = options.hostname ?? '0.0.0.0'
	const onListen = options.onListen ?? defaultOnListen
	const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 30000

	// @ts-ignore — Deno.serve types
	const server = Deno.serve(
		{ port, hostname, onListen: () => onListen({ port, hostname }) },
		app.fetch,
	)

	const handle: ServerHandle = {
		async shutdown() {
			// Drain HTTP server first (stop accepting, wait for in-flight)
			await server.shutdown()
			// Then run application cleanup callbacks
			await runShutdown()
		},
	}

	registerSignalHandlers(() => handle.shutdown(), shutdownTimeoutMs)

	return Promise.resolve(handle)
}

let signalHandlersRegistered = false

function registerSignalHandlers(handler: () => Promise<void>, timeoutMs: number): void {
	if (signalHandlersRegistered) return
	signalHandlersRegistered = true

	const onSignal = async () => {
		console.log('Received shutdown signal; draining...')

		const timeout = setTimeout(() => {
			console.error(`Shutdown timed out after ${timeoutMs}ms; forcing exit`)
			// @ts-ignore — Deno.exit
			Deno.exit(1)
		}, timeoutMs)

		try {
			await handler()
			clearTimeout(timeout)
			console.log('Shutdown complete')
			// @ts-ignore — Deno.exit
			Deno.exit(0)
		} catch (err) {
			clearTimeout(timeout)
			console.error('Shutdown failed:', err)
			// @ts-ignore — Deno.exit
			Deno.exit(1)
		}
	}

	// @ts-ignore — Deno.addSignalListener
	Deno.addSignalListener('SIGTERM', onSignal)
	Deno.addSignalListener('SIGINT', onSignal)
}

function defaultOnListen({ port, hostname }: { port: number; hostname: string }): void {
	console.log(`Listening on http://${hostname}:${port}`)
}