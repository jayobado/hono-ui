export type ServeOptions = {
	/** Port to listen on. Default: 3000. */
	port?: number
	/** Hostname to bind. Default: '0.0.0.0' (all interfaces). */
	hostname?: string
	/**
	 * Called once the server starts listening. Receives the port for logging.
	 * Default: console.log a startup line.
	 */
	onListen?: (info: { port: number; hostname: string }) => void
	/**
	 * Maximum time to wait for graceful shutdown. After this, the process
	 * exits with code 1 even if cleanup is still running. Default: 30000 (30s).
	 */
	shutdownTimeoutMs?: number
}

export type ServerHandle = {
	/** Stop accepting new connections, drain in-flight, run cleanup callbacks. */
	shutdown: () => Promise<void>
}