/**
 * Session data persisted between requests.
 *
 * The shape is intentionally narrow to what auth itself manages. Applications
 * extend it via the type parameter to add their own fields (role, tenant,
 * preferences, etc.).
 */
export type BaseSessionData = {
	/** Stable user identifier. */
	userId: string
	/** Access token used for upstream requests. */
	accessToken: string
	/** Refresh token for renewing access. Optional — not all flows produce one. */
	refreshToken?: string
	/** When accessToken expires, as a Unix epoch ms. */
	expiresAt?: number
	/** When the session itself expires (separate from token lifetime). */
	sessionExpiresAt?: number
}

/**
 * Session storage port. Applications provide an implementation via
 * createMemoryStore, the CF-stores subpath, or their own.
 *
 * The interface is async because real stores (KV, Postgres, Redis) are
 * always async. Memory store wraps sync in Promise.resolve to satisfy the
 * contract — small overhead, large gain in implementation interchangeability.
 */
export interface SessionStore<S extends BaseSessionData = BaseSessionData> {
	/** Get session data by ID. Returns null if not found or expired. */
	get(id: string): Promise<S | null>
	/** Store session data under an ID. Overwrites if present. */
	set(id: string, data: S): Promise<void>
	/** Delete a session. No-op if not present. */
	delete(id: string): Promise<void>
}