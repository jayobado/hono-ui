// src/auth/refresh.ts

import type { BaseSessionData } from './store.ts'

export type RefreshOptions = {
	refresh: (refreshToken: string) => Promise<RefreshResult>
	graceSeconds?: number
}

export type RefreshResult = {
	accessToken: string
	refreshToken?: string
	expiresAt: number
}

export function createRefreshRunner(options: RefreshOptions) {
	const graceMs = (options.graceSeconds ?? 60) * 1000

	return {
		shouldRefresh(session: BaseSessionData): boolean {
			if (!session.refreshToken) return false
			if (!session.expiresAt) return false
			return session.expiresAt - Date.now() < graceMs
		},

		async run(session: BaseSessionData): Promise<BaseSessionData | null> {
			if (!session.refreshToken) return null

			try {
				const result = await options.refresh(session.refreshToken)
				return {
					...session,
					accessToken: result.accessToken,
					refreshToken: result.refreshToken ?? session.refreshToken,
					expiresAt: result.expiresAt,
				}
			} catch {
				return null
			}
		},
	}
}

export type RefreshRunner = ReturnType<typeof createRefreshRunner>