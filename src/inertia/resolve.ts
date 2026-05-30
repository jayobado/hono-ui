import type { Context } from 'hono'
import type { Page, PropContext } from './page.ts'
import { resolveShared, type SharedProvider } from './shared.ts'
import {
	isWrapped,
	type WrappedProp,
	type DeferredProp,
	type PropEvaluator,
} from './props.ts'
import type { SsrClient } from './ssr.ts'

const HEADER_INERTIA = 'X-Inertia'
const HEADER_VERSION = 'X-Inertia-Version'
const HEADER_PARTIAL_DATA = 'X-Inertia-Partial-Data'
const HEADER_PARTIAL_COMPONENT = 'X-Inertia-Partial-Component'
const HEADER_PARTIAL_EXCEPT = 'X-Inertia-Partial-Except'

/**
 * Configuration the resolver needs that isn't part of an individual Page.
 * Comes from the createInertiaApp factory; passed to resolve() on every call.
 */
export type ResolverConfig = {
	version: string
	renderRootView: (params: {
		page: PageObject
		viewData: Record<string, unknown>
		rootView: string
		ssrHead?: string
		ssrBody?: string
	}) => string
	sharedProviders: SharedProvider[]
	ssr?: SsrClient            // NEW: optional SSR client
}

/**
 * The on-the-wire page object — what the client decodes from data-page or
 * receives as JSON. Exactly matches Inertia's protocol.
 */
export type PageObject = {
	component: string
	props: Record<string, unknown>
	url: string
	version: string
	encryptHistory: boolean
	clearHistory: boolean
}

/**
 * Resolve a Page against the current Context into an HTTP Response.
 *
 * Steps, in order:
 *   1. Check asset version → 409 hard reload if mismatched
 *   2. Resolve shared data (static providers + per-request bag)
 *   3. Merge shared props with page props (page props win)
 *   4. Filter and evaluate props per partial-reload + wrapper rules
 *   5. Build the protocol page object
 *   6. Emit JSON or HTML based on X-Inertia header
 */
export async function resolve(
	page: Page,
	ctx: Context,
	cfg: ResolverConfig,
): Promise<Response> {
	const { descriptor } = page
	const isInertia = ctx.req.header(HEADER_INERTIA) === 'true'
	const requestVersion = ctx.req.header(HEADER_VERSION)

	// 1. Version check — only matters for Inertia GET requests
	if (isInertia && ctx.req.method === 'GET' && requestVersion !== cfg.version) {
		return new Response(null, {
			status: 409,
			headers: { 'X-Inertia-Location': ctx.req.url },
		})
	}

	// 2-3. Shared data + page props, with page winning
	const shared = await resolveShared(ctx, cfg.sharedProviders)
	const merged: Record<string, unknown> = { ...shared, ...descriptor.props }

	// 4. Filter + evaluate props (wrappers, partial reloads, lazy closures)
	const props = await evaluateProps(merged, ctx, descriptor.component)

	// 5. Build the protocol page object
	const url = new URL(ctx.req.url)
	const pageObject: PageObject = {
		component: descriptor.component,
		props,
		url: url.pathname + url.search,
		version: cfg.version,
		encryptHistory: descriptor.encryptHistory,
		clearHistory: descriptor.clearHistory,
	}

	// 6. Emit JSON or HTML
	if (isInertia) {
		return new Response(JSON.stringify(pageObject), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'X-Inertia': 'true',
				'Vary': 'X-Inertia',
			},
		})
	}

	let ssrHead: string | undefined
	let ssrBody: string | undefined

	if (cfg.ssr) {
		const result = await cfg.ssr.render(pageObject)
		ssrHead = result.head.join('\n')
		ssrBody = result.body
	}

	const html = cfg.renderRootView({
		page: pageObject,
		viewData: descriptor.viewData,
		rootView: descriptor.rootView,
		ssrHead,
		ssrBody,
	})

	return new Response(html, {
		status: 200,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Vary': 'X-Inertia',
		},
	})
}

/**
 * Filter props by partial-reload headers, then evaluate.
 *
 * See decideProp below for the full table of behavior. Eight cases total:
 * five wrapper kinds (lazy, optional, always, deferred, merge) plus plain
 * values, plain closures, and how they combine with partial-reload state.
 */
async function evaluateProps(
	merged: Record<string, unknown>,
	ctx: Context,
	component: string,
): Promise<Record<string, unknown>> {
	const partialComponent = ctx.req.header(HEADER_PARTIAL_COMPONENT)
	const isPartial = partialComponent === component

	const onlyHeader = ctx.req.header(HEADER_PARTIAL_DATA)
	const exceptHeader = ctx.req.header(HEADER_PARTIAL_EXCEPT)
	const only = isPartial ? onlyHeader?.split(',').filter(Boolean) : undefined
	const except = isPartial ? exceptHeader?.split(',').filter(Boolean) : undefined

	const out: Record<string, unknown> = {}
	const allProps: Record<string, unknown> = {}
	const filterCtx = { isPartial, only, except }

	for (const [key, value] of Object.entries(merged)) {
		const decision = decideProp(key, value, filterCtx)
		if (decision.kind === 'skip') continue

		const propCtx: PropContext = { ctx, key, allProps }

		if (decision.kind === 'defer') {
			out[key] = { __deferred: true, group: decision.group }
		} else if (decision.kind === 'merge') {
			const value = await decision.evaluator(propCtx)
			out[key] = { __value: value, __merge: true }
		} else {
			// 'evaluate' — plain value, plain closure, or wrapper that runs now
			const e = decision.evaluator
			out[key] = typeof e === 'function'
				? await (e as PropEvaluator)(propCtx)
				: e
		}

		allProps[key] = out[key]
	}

	return out
}

type FilterCtx = { isPartial: boolean; only?: string[]; except?: string[] }

type Decision =
	| { kind: 'skip' }
	| { kind: 'evaluate'; evaluator: unknown }
	| { kind: 'defer'; group?: string }
	| { kind: 'merge'; evaluator: PropEvaluator }

/**
 * The per-prop decision table.
 *
 *   PLAIN VALUE / CLOSURE
 *     Full load:    evaluate
 *     Partial:      evaluate if passes filter (only/except)
 *
 *   LAZY
 *     Full load:    skip
 *     Partial:      evaluate ONLY if explicitly in `only`
 *
 *   OPTIONAL
 *     Full load:    evaluate
 *     Partial:      evaluate ONLY if explicitly in `only`
 *
 *   ALWAYS
 *     Full load:    evaluate
 *     Partial:      evaluate (bypasses filter)
 *
 *   DEFERRED
 *     Full load:    emit placeholder { __deferred: true, group }
 *     Partial:      evaluate if `only` contains this key (the follow-up)
 *                   else still emit placeholder
 *
 *   MERGE
 *     Full load:    evaluate, wrap as { __value, __merge: true }
 *     Partial:      same if passes filter, else skip
 */
function decideProp(key: string, value: unknown, ctx: FilterCtx): Decision {
	if (isWrapped(value)) {
		const w = value as WrappedProp

		if (w.kind === 'always') {
			return { kind: 'evaluate', evaluator: w.evaluator }
		}

		if (w.kind === 'lazy') {
			if (ctx.isPartial && ctx.only?.includes(key)) {
				return { kind: 'evaluate', evaluator: w.evaluator }
			}
			return { kind: 'skip' }
		}

		if (w.kind === 'optional') {
			if (!ctx.isPartial) {
				return { kind: 'evaluate', evaluator: w.evaluator }
			}
			if (ctx.only?.includes(key)) {
				return { kind: 'evaluate', evaluator: w.evaluator }
			}
			return { kind: 'skip' }
		}

		if (w.kind === 'deferred') {
			const isFollowup = ctx.isPartial && ctx.only?.includes(key)
			if (isFollowup) {
				return { kind: 'evaluate', evaluator: w.evaluator }
			}
			return { kind: 'defer', group: (w as DeferredProp).group }
		}

		if (w.kind === 'merge') {
			if (passesFilter(key, ctx)) {
				return { kind: 'merge', evaluator: w.evaluator }
			}
			return { kind: 'skip' }
		}
	}

	// Plain values and plain closures
	if (passesFilter(key, ctx)) {
		return { kind: 'evaluate', evaluator: value }
	}
	return { kind: 'skip' }
}

function passesFilter(key: string, ctx: FilterCtx): boolean {
	if (!ctx.isPartial) return true
	if (ctx.only && !ctx.only.includes(key)) return false
	if (ctx.except && ctx.except.includes(key)) return false
	return true
}