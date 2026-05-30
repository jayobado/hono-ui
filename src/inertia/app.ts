import type { Context, MiddlewareHandler } from 'hono'
import { resolve, type ResolverConfig } from './resolve.ts'
import { sharedMiddleware, SHARED_BAG_KEY } from './shared.ts'
import {
	errorsMiddleware,
	errorsProvider,
	addError as addErrorInternal,
	addErrors as addErrorsInternal,
	readErrors as readErrorsInternal,
	type WireErrors,
	ERROR_STATE_KEY,
} from './errors.ts'
import { Page, type PropValue } from './page.ts'

export type InertiaAppConfig = ResolverConfig

// ─── Options types ──────────────────────────────────────────────────────────

export type RenderOptions = {
	ctx: Context
	component: string
	props?: Record<string, PropValue>
	viewData?: Record<string, unknown>
	cache?: number | number[]
	rootView?: string
	encryptHistory?: boolean
	clearHistory?: boolean
}

export type RedirectOptions = {
	ctx: Context
	url: string
	status?: number
}

export type LocationOptions = {
	url: string
}

export type ShareOptions = {
	ctx: Context
	key: string
	value: PropValue
}

export type ShareAllOptions = {
	ctx: Context
	values: Record<string, PropValue>
}

export type AddErrorOptions = {
	ctx: Context
	field: string
	message: string
	bag?: string
}

export type AddErrorsOptions = {
	ctx: Context
	errors: Record<string, string>
	bag?: string
}

export type ReadErrorsOptions = {
	ctx: Context
}

// ─── Instance ───────────────────────────────────────────────────────────────

export type InertiaInstance = {
	middleware: MiddlewareHandler

	/** Render a page to an HTTP Response. */
	render(options: RenderOptions): Promise<Response>

	/** Internal redirect — 302 (or auto-303 for PUT/PATCH/DELETE). */
	redirect(options: RedirectOptions): Response

	/** External redirect — 409 with X-Inertia-Location for full navigation. */
	location(options: LocationOptions): Response

	/** Add one prop to the per-request shared bag. */
	share(options: ShareOptions): void

	/** Add many props to the per-request shared bag. */
	shareAll(options: ShareAllOptions): void

	/** Record a single validation error. */
	addError(options: AddErrorOptions): void

	/** Record many validation errors at once. */
	addErrors(options: AddErrorsOptions): void

	/** Read the current request's error bag in the on-wire shape. */
	readErrors(options: ReadErrorsOptions): WireErrors
}

export function createInertiaApp(cfg: InertiaAppConfig): InertiaInstance {
	const finalCfg: ResolverConfig = {
		...cfg,
		sharedProviders: [...cfg.sharedProviders, errorsProvider()],
	}

	// ─── render ─────────────────────────────────────────────────────────────
	const render = (options: RenderOptions): Promise<Response> => {
		let page = Page.create(options.component, options.props ?? {})

		if (options.viewData) page = page.withViewData(options.viewData)
		if (options.cache !== undefined) {
			page = page.cache(...(Array.isArray(options.cache) ? options.cache : [options.cache]))
		}
		if (options.rootView) page = page.rootView(options.rootView)
		if (options.encryptHistory !== undefined) page = page.encryptHistory(options.encryptHistory)
		if (options.clearHistory !== undefined) page = page.clearHistory(options.clearHistory)

		return resolve(page, options.ctx, finalCfg)
	}

	// ─── redirect ───────────────────────────────────────────────────────────
	const redirect = (options: RedirectOptions): Response => {
		let status = options.status
		if (status === undefined) {
			const method = options.ctx.req.method
			status = (method === 'PUT' || method === 'PATCH' || method === 'DELETE') ? 303 : 302
		}
		return new Response(null, { status, headers: { Location: options.url } })
	}

	// ─── location ───────────────────────────────────────────────────────────
	const location = (options: LocationOptions): Response => {
		return new Response(null, {
			status: 409,
			headers: { 'X-Inertia-Location': options.url },
		})
	}

	// ─── share / shareAll ──────────────────────────────────────────────────
	const share = (options: ShareOptions): void => {
		const bag = options.ctx.get(SHARED_BAG_KEY) as Record<string, PropValue> | undefined
		if (!bag) throw new Error('inertia middleware not mounted')
		bag[options.key] = options.value
	}

	const shareAll = (options: ShareAllOptions): void => {
		const bag = options.ctx.get(SHARED_BAG_KEY) as Record<string, PropValue> | undefined
		if (!bag) throw new Error('inertia middleware not mounted')
		for (const [k, v] of Object.entries(options.values)) bag[k] = v
	}

	// ─── errors ─────────────────────────────────────────────────────────────
	const addError = (options: AddErrorOptions): void => {
		addErrorInternal(options.ctx, options.field, options.message, options.bag)
	}

	const addErrors = (options: AddErrorsOptions): void => {
		addErrorsInternal(options.ctx, options.errors, options.bag)
	}

	const readErrors = (options: ReadErrorsOptions): WireErrors => {
		return readErrorsInternal(options.ctx)
	}

	// ─── middleware ─────────────────────────────────────────────────────────
	const middleware = composeMiddleware(
		errorsMiddleware(),
		sharedMiddleware(),
	)

	return {
		middleware,
		render, redirect, location,
		share, shareAll,
		addError, addErrors, readErrors,
	}
}

function composeMiddleware(...mws: MiddlewareHandler[]): MiddlewareHandler {
	return async (c, next) => {
		let i = 0
		const run = async (): Promise<void> => {
			if (i >= mws.length) return next()
			const mw = mws[i++]
			await mw(c, run)
		}
		await run()
	}
}