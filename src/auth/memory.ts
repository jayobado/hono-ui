import type { BaseSessionData, SessionStore } from './store.ts'

/**
 * In-memory session store. Useful for development and single-instance
 * deployments. Sessions are lost on process restart.
 *
 * For production, use the CF-stores subpath (KV / Durable Objects) or
 * write a Postgres/Redis adapter satisfying the SessionStore interface.
 */
export function createMemoryStore<S extends BaseSessionData = BaseSessionData>(): SessionStore<S> {
	const data = new Map<string, S>()

	return {
		get(id) { return Promise.resolve(data.get(id) ?? null) },
		set(id, value) { data.set(id, value); return Promise.resolve() },
		delete(id) { data.delete(id); return Promise.resolve() },
	}
}