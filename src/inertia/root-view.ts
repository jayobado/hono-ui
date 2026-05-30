import type { PageObject } from './resolve.ts'

function encodeDataPage(page: PageObject): string {
	const bytes = new TextEncoder().encode(JSON.stringify(page))
	let bin = ''
	for (const b of bytes) bin += String.fromCharCode(b)
	return btoa(bin)
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
		.replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export type RenderRootViewConfig = {
	entry: string                     // your JS bundle URL, e.g. '/assets/main.js'
	defaultTitle?: string
	lang?: string
	extraHead?: string                // raw HTML to inject into <head>
}

/**
 * A reasonable default renderRootView. Pass the result into createInertiaApp.
 *
 *   renderRootView: renderRootView({ entry: '/assets/main.js' })
 *
 * If you need anything this doesn't give you (multiple shells, custom meta
 * tags, link preload hints), don't extend this — just write your own
 * function with the same signature. It's 30 lines.
 */
export function renderRootView(cfg: RenderRootViewConfig) {
	return (input: {
		page: PageObject
		viewData: Record<string, unknown>
		rootView: string
		ssrHead?: string
		ssrBody?: string
	}): string => {
		const dataPage = encodeDataPage(input.page)
		const title = typeof input.viewData.title === 'string'
			? escapeHtml(input.viewData.title)
			: escapeHtml(cfg.defaultTitle ?? '')

		return `
			<!DOCTYPE html>
			<html lang="${cfg.lang ?? 'en'}">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1">
					<title>${title}</title>
					${cfg.extraHead ?? ''}
					${input.ssrHead ?? ''}
					<script type="module" src="${cfg.entry}"></script>
				</head>
				<body>
					<div id="app" data-page="${dataPage}">${input.ssrBody ?? ''}</div>
				</body>
			</html>
		`
	}
}