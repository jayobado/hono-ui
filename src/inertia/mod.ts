// src/inertia/mod.ts

/**
 * @module
 * Inertia.js protocol adapter for Hono.
 *
 *   import { createInertiaApp } from '@jayobado/hono-kit/inertia'
 *
 *   const inertia = createInertiaApp({ ... })
 *   app.get('/', (c) => inertia.render({ ctx: c, component: 'home' }))
 */

// ─── The factory ────────────────────────────────────────────────────────────
export { createInertiaApp } from './app.ts'
export type {
	InertiaAppConfig,
	InertiaInstance,
	RenderOptions,
	RedirectOptions,
	LocationOptions,
	ShareOptions,
	ShareAllOptions,
	AddErrorOptions,
	AddErrorsOptions,
	ReadErrorsOptions,
} from './app.ts'

// ─── Page descriptor (advanced use — tests, building descriptors externally) ─
export { Page } from './page.ts'
export type { PageDescriptor, PropValue, PropContext } from './page.ts'

// ─── Shared provider type (for application providers) ───────────────────────
export type { SharedProvider } from './shared.ts'

// ─── Error types ────────────────────────────────────────────────────────────
export type { ErrorBag, ScopedErrors, WireErrors } from './errors.ts'

// ─── Validation (optional helper) ────────────────────────────────────────────
export { validateOrRedirect } from './validate.ts'
export type {
	ValidationResult,
	Flasher,
	ValidateOrRedirectOptions,
	ValidateOrRedirectResult,
} from './validate.ts'

// ─── Prop wrappers ───────────────────────────────────────────────────────────
export { lazy, optional, always, defer, merge, isWrapped } from './props.ts'
export type {
	LazyProp, OptionalProp, AlwaysProp, DeferredProp, MergeProp,
	WrappedProp, PropEvaluator,
} from './props.ts'

// ─── Root view helper ────────────────────────────────────────────────────────
export { renderRootView } from './root-view.ts'
export type { RenderRootViewConfig } from './root-view.ts'

// ─── SSR client ──────────────────────────────────────────────────────────────
export { createHttpSsrClient } from './ssr.ts'
export type { SsrClient, SsrRenderResult, HttpSsrClientConfig } from './ssr.ts'

// ─── Internal types apps occasionally need ───────────────────────────────────
export type { PageObject, ResolverConfig } from './resolve.ts'