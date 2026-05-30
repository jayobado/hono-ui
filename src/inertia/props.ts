import type { PropContext } from './page.ts'

/**
 * Internal marker that distinguishes wrapped props from plain values and
 * plain closures. Using a Symbol prevents collisions with user data — a
 * user object can never accidentally look like a wrapped prop.
 */
const WRAPPER = Symbol.for('inertia.prop.wrapper')

export type PropEvaluator = (ctx: PropContext) => unknown | Promise<unknown>

type Wrapped<Kind extends string> = {
	[WRAPPER]: true
	kind: Kind
	evaluator: PropEvaluator
}

export type LazyProp = Wrapped<'lazy'>
export type OptionalProp = Wrapped<'optional'>
export type AlwaysProp = Wrapped<'always'>
export type DeferredProp = Wrapped<'deferred'> & { group?: string }
export type MergeProp = Wrapped<'merge'> & { inner: PropEvaluator }

export type WrappedProp = LazyProp | OptionalProp | AlwaysProp | DeferredProp | MergeProp

/**
 * Type guard — true if a value is one of our prop wrappers, false for
 * plain data, plain closures, anything else.
 */
export function isWrapped(v: unknown): v is WrappedProp {
	return typeof v === 'object'
		&& v !== null
		&& (v as Record<symbol, unknown>)[WRAPPER] === true
}

/**
 * Lazy: never sent unless this partial reload explicitly asks for it via
 * `only: ['propName']`. Skipped on full page loads.
 *
 *   props: { comments: lazy(() => fetchComments(postId)) }
 *
 * Use for data that's expensive to fetch and only needed for specific
 * client-driven re-fetches (e.g., toggling a "show comments" view).
 */
export function lazy(evaluator: PropEvaluator): LazyProp {
	return { [WRAPPER]: true, kind: 'lazy', evaluator }
}

/**
 * Optional: included on full page loads, skipped on partial reloads unless
 * explicitly requested. This is the "default" lazy — most expensive data
 * fits this shape (you want it on the first page load, but a partial reload
 * for some other prop shouldn't re-fetch it).
 *
 *   props: { stats: optional(() => computeStats()) }
 */
export function optional(evaluator: PropEvaluator): OptionalProp {
	return { [WRAPPER]: true, kind: 'optional', evaluator }
}

/**
 * Always: sent on every response — including partial reloads that didn't
 * ask for it. The partial-reload `only` filter does NOT exclude `always`
 * props.
 *
 *   props: { flash: always(() => pullFlash(c)) }
 *
 * Use sparingly. The point is for protocol-level "must always be present"
 * data — flash messages, csrf rotation, auth state changes — not as a way
 * to bypass filtering.
 */
export function always(evaluator: PropEvaluator): AlwaysProp {
	return { [WRAPPER]: true, kind: 'always', evaluator }
}

/**
 * Defer: emit a placeholder on the initial response; the Inertia client
 * makes a follow-up request to fetch the real value.
 *
 *   props: { analytics: defer(() => expensiveAnalytics()) }
 *
 * Optional `group` parameter coalesces multiple deferred props into a single
 * follow-up request:
 *
 *   props: {
 *     stats:    defer(() => computeStats(),    'dashboard'),
 *     activity: defer(() => recentActivity(),  'dashboard'),  // one request, both props
 *   }
 *
 * See "Defer protocol" below for what the wire shape looks like.
 */
export function defer(evaluator: PropEvaluator, group?: string): DeferredProp {
	return { [WRAPPER]: true, kind: 'deferred', evaluator, group }
}

/**
 * Merge: signal that the resolved value should be deep-merged with the
 * client's current value of this prop rather than replacing it. Used for
 * pagination / infinite scroll, where a partial reload appends rows.
 *
 *   props: { items: merge(() => fetchPage(page)) }
 *
 * The client form helpers (or your own page logic) handle the actual merge;
 * the adapter just sets a flag on the prop so the client knows.
 */
export function merge(evaluator: PropEvaluator): MergeProp {
	return { [WRAPPER]: true, kind: 'merge', evaluator, inner: evaluator }
}