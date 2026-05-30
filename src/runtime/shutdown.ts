/**
 * Process-level shutdown registry. Callbacks run when the server shuts down,
 * either from a signal handler or from manual handle.shutdown() call.
 *
 * The registry is module-level on purpose — anywhere in the kit or
 * application code can register cleanup, and it all runs together at
 * shutdown time. Auth/upstream/etc. may register cleanups from their
 * factories; applications register theirs imperatively.
 */

const callbacks: Array<() => void | Promise<void>> = []

/**
 * Register a function to run during graceful shutdown.
 *
 *   onShutdown(async () => { await db.close() })
 *   onShutdown(() => { logger.flush() })
 *
 * Callbacks run in registration order. Failures are logged but don't block
 * other callbacks. Idempotent — calling onShutdown with the same function
 * multiple times registers it multiple times (so don't do that).
 */
export function onShutdown(fn: () => void | Promise<void>): void {
	callbacks.push(fn)
}

/**
 * Run all registered shutdown callbacks. Called by serveDeno/serveNode's
 * shutdown handle; applications generally don't call this directly.
 */
export async function runShutdown(): Promise<void> {
	for (const fn of callbacks) {
		try {
			await fn()
		} catch (err) {
			console.error('Shutdown callback failed:', err)
		}
	}
}