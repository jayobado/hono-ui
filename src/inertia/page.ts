import type { Context } from 'hono'

/**
 * Component naming convention
 * ---------------------------
 * Component names are logical identifiers in dot notation: 'orders.show',
 * 'admin.users.edit', 'auth.login'. They are NOT filesystem paths.
 *
 * The client-side page registry maps these logical names to dynamic imports:
 *
 *   'orders.show' -> () => import('./pages/orders/show.ts')
 *
 * The key is the contract; the file location is a convention. Pick a logical
 * namespace (matches your route names, generally) rather than mirroring the
 * filesystem.
 *
 * This also lets the component name and the route name be the same string,
 * which collapses the two naming systems into one — see the route registry.
 */

// The descriptor, frozen after construction except via fluent chain methods.
export type PageDescriptor = {
	component: string                      // 'orders.show', 'admin.users.edit', etc.
	props: Record<string, PropValue>
	viewData: Record<string, unknown>      // data for the HTML shell, NOT sent to client
	rootView: string                        // which root view template to render (default 'app')
	encryptHistory: boolean
	clearHistory: boolean
	cacheFor: number[]                      // see Laravel's cacheFor; used in Step 8
}

// Prop values can be plain data, a closure (lazy), or an async closure.
export type PropValue =
	| unknown
	| ((ctx: PropContext) => unknown)
	| ((ctx: PropContext) => Promise<unknown>)

// Equivalent to Laravel's PropertyContext — gives lazy props access to request + sibling props.
export type PropContext = {
	ctx: Context
	key: string
	allProps: Record<string, unknown>
}

/**
 * A Page is a descriptor + fluent methods to refine it.
 * It is NOT a Response; it is resolved into one by the resolver in Step 3.
 *
 * Construction is pure and synchronous. No request reads, no session access,
 * no side effects. That's what makes it independently testable and what lets
 * middleware mutate or wrap pages before they resolve to HTTP.
 */
export class Page {
	constructor(public readonly descriptor: PageDescriptor) { }

	static create(component: string, props: Record<string, PropValue> = {}): Page {
		return new Page({
			component,
			props,
			viewData: {},
			rootView: 'app',
			encryptHistory: false,
			clearHistory: false,
			cacheFor: [],
		})
	}

	/** Merge in more props — equivalent to Laravel's ->with(['x' => 'y']). */
	with(more: Record<string, PropValue>): Page {
		return new Page({
			...this.descriptor,
			props: { ...this.descriptor.props, ...more },
		})
	}

	/**
	 * Attach view data for the HTML shell (NOT serialized to the client).
	 * Used for <title>, meta tags, anything the shell template needs but the
	 * client-side page should not receive. Mixing this with props is the most
	 * common adapter bug — keep server-only data here.
	 */
	withViewData(data: Record<string, unknown>): Page {
		return new Page({
			...this.descriptor,
			viewData: { ...this.descriptor.viewData, ...data },
		})
	}

	/** Choose a non-default root view template. */
	rootView(name: string): Page {
		return new Page({ ...this.descriptor, rootView: name })
	}

	/** Cache control — see Step 5 / Step 8. */
	cache(...durations: number[]): Page {
		return new Page({ ...this.descriptor, cacheFor: durations })
	}

	/** Encrypt history state (Laravel 2.x parity). */
	encryptHistory(value = true): Page {
		return new Page({ ...this.descriptor, encryptHistory: value })
	}

	/** Clear history state (Laravel 2.x parity). */
	clearHistory(value = true): Page {
		return new Page({ ...this.descriptor, clearHistory: value })
	}
}