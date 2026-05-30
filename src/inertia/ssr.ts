import type { PageObject } from './resolve.ts'

/**
 * Response shape the SSR server returns. Matches Inertia's official SSR
 * server convention so any compatible server (Inertia's own, or one you
 * write) works.
 */
export type SsrRenderResult = {
	head: string[]      // array of head tag strings to inject
	body: string        // body HTML to inject into the mount div
}

export type SsrClient = {
	/**
	 * Render a page object via the SSR server. Returns the rendered head + body.
	 *
	 * If the SSR server is unreachable, returns empty strings — the page falls
	 * back to client-only rendering. This is by design: SSR failure should
	 * never block the page.
	 */
	render(page: PageObject): Promise<SsrRenderResult>
}

export type HttpSsrClientConfig = {
	url: string             // 'http://127.0.0.1:13714/render' is the convention
	timeoutMs?: number      // default 1500ms — fail fast if SSR is slow
	onError?: (err: unknown) => void
}

/**
 * The standard HTTP-based SSR client. POSTs the page object as JSON, expects
 * { head, body } back. Soft-fails on any error.
 */
export function createHttpSsrClient(cfg: HttpSsrClientConfig): SsrClient {
	return {
		async render(page: PageObject): Promise<SsrRenderResult> {
			const controller = new AbortController()
			const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 1500)

			try {
				const response = await fetch(cfg.url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(page),
					signal: controller.signal,
				})

				if (!response.ok) {
					throw new Error(`SSR server returned ${response.status}`)
				}

				const result = await response.json() as SsrRenderResult
				if (!result || typeof result.body !== 'string' || !Array.isArray(result.head)) {
					throw new Error('SSR server returned invalid shape')
				}

				return result
			} catch (err) {
				cfg.onError?.(err)
				return { head: [], body: '' }
			} finally {
				clearTimeout(timer)
			}
		},
	}
}