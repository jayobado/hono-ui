import type { Context, MiddlewareHandler } from 'hono'
import type { SharedProvider } from './shared.ts'

/**
 * The unscoped shape: field → first message.
 *
 *   { email: 'required', password: 'must be at least 8 characters' }
 */
export type ErrorBag = Record<string, string>

/**
 * The scoped shape: bag name → ErrorBag. Used when multiple forms on the
 * same page need separate error namespaces.
 *
 *   { default: { email: 'required' }, password: { current: 'required' } }
 */
export type ScopedErrors = Record<string, ErrorBag>

/**
 * What ends up on the wire as the `errors` prop. The Inertia client form
 * helpers handle both flat (single bag) and scoped (multiple bags) shapes.
 *
 * The adapter chooses which to emit:
 *   - If only the 'default' bag has been written to, emit it flat
 *   - If any other bag has entries, emit the full scoped object
 */
export type WireErrors = ErrorBag | ScopedErrors

/**
 * Per-request error bag — collects errors written during this request
 * lifecycle. Stored on the Context so it's request-scoped automatically.
 *
 * This is the WRITE side. The READ side is the errors shared provider,
 * which reads from this bag at resolution time. Flashed errors (from a
 * previous request, surviving a redirect) come in through the application's
 * shared provider, NOT through this bag.
 */
type ErrorState = {
	bags: Map<string, ErrorBag>     // bag name → field errors
}

export const ERROR_STATE_KEY = '__hono_ui_inertia_errors'

/**
 * Initialize the error state on the context. Run as middleware so any later
 * code can call addError(c, ...) without checking if state exists.
 */
export function errorsMiddleware(): MiddlewareHandler {
	return async (c, next) => {
		c.set(ERROR_STATE_KEY, { bags: new Map() })
		await next()
	}
}

/**
 * Add a single error. Defaults to the 'default' bag.
 *
 *   addError(c, 'email', 'must be a valid email address')
 *   addError(c, 'current', 'required', 'password')   // scoped to 'password' bag
 *
 * If you call addError multiple times for the same field, the first one wins
 * (matches Laravel's "first message per field" rule). Subsequent calls are
 * ignored. This keeps the on-the-wire shape stable: errors[field] is always
 * a single string.
 */
export function addError(c: Context, field: string, message: string, bag = 'default'): void {
	const state = c.get(ERROR_STATE_KEY) as ErrorState | undefined
	if (!state) throw new Error('errorsMiddleware not mounted')

	let target = state.bags.get(bag)
	if (!target) {
		target = {}
		state.bags.set(bag, target)
	}
	if (!(field in target)) {
		target[field] = message
	}
}

/**
 * Add many errors at once, optionally to a specific bag.
 *
 *   addErrors(c, { email: 'required', password: 'too short' })
 *   addErrors(c, { current: 'required' }, 'password')
 *
 * Equivalent to looping addError. Same first-wins semantics per field.
 */
export function addErrors(c: Context, errors: Record<string, string>, bag = 'default'): void {
	for (const [field, message] of Object.entries(errors)) {
		addError(c, field, message, bag)
	}
}

/**
 * Read the current request's errors as the on-wire shape.
 * The adapter's built-in errors provider uses this; you usually don't call it.
 *
 * Shape rule:
 *   - If only the 'default' bag exists (or no errors at all), return flat:
 *       { email: 'required' }  or  {}
 *   - If any other bag has entries, return scoped:
 *       { default: {...}, password: {...} }
 */
export function readErrors(c: Context): WireErrors {
	const state = c.get(ERROR_STATE_KEY) as ErrorState | undefined
	if (!state) return {}

	const bags = state.bags
	const otherBags = [...bags.keys()].filter((k) => k !== 'default')

	if (otherBags.length === 0) {
		return bags.get('default') ?? {}
	}

	const out: ScopedErrors = {}
	for (const [name, bag] of bags) {
		out[name] = bag
	}
	return out
}

/**
 * The built-in errors shared provider. Reads the current request's errors
 * AND merges in any errors the application's flash mechanism provided.
 *
 * The application doesn't register this directly — it's added automatically
 * by createInertiaApp. The application DOES register a flash provider that
 * adds previously-flashed errors via addErrors(), if it has form-validation
 * flows that survive redirects.
 *
 * Why this is built-in: `errors` is a protocol-level convention. Pages and
 * form helpers expect to find errors at `errors.{field}` (or
 * `errors.{bag}.{field}`) regardless of which app this is. Other shared data
 * (auth, flash, csrf) is application-specific; errors is protocol-specific.
 */
export function errorsProvider(): SharedProvider {
	return (c: Context) => ({
		errors: readErrors(c),
	})
}