import type { Context } from 'hono'
import { addErrors, readErrors } from './errors.ts'

export type ValidationResult<T> =
	| { kind: 'ok'; value: T }
	| { kind: 'errors'; errors: Record<string, string> }

export type Flasher = (c: Context, errors: Record<string, string>) => Promise<void>

export type ValidateOrRedirectOptions<T> = {
	ctx: Context
	validator: () => ValidationResult<T> | Promise<ValidationResult<T>>
	redirect: (opts: { ctx: Context; url: string }) => Response   // pass inertia.redirect
	flashTo?: Flasher
	redirectTo?: string
	bag?: string
}

export type ValidateOrRedirectResult<T> =
	| { kind: 'ok'; value: T }
	| { kind: 'redirect'; response: Response }

/**
 * Validate input. On error, write to the error bag, optionally flash, and
 * return a redirect Response. On success, return the parsed value.
 *
 *   const result = await validateOrRedirect({
 *     ctx: c,
 *     validator: () => zodValidator(OrderSchema, await c.req.json()),
 *     redirect: inertia.redirect,
 *     flashTo: session.flashErrors,
 *     redirectTo: '/orders/new',
 *   })
 *   if (result.kind === 'redirect') return result.response
 *   // result.kind === 'ok' — use result.value
 *
 * The `redirect` field accepts inertia.redirect directly. The signatures
 * line up — inertia.redirect takes { ctx, url } and returns a Response.
 *
 * `flashTo` is optional. Without it, errors stay in the current request
 * only — useful when you re-render the same page with errors instead of
 * redirecting. (With no flashTo, the redirect still happens, but the next
 * page won't see the errors unless you also write them to session
 * somewhere else.)
 *
 * `redirectTo` defaults to the Referer header, then '/'. Most form-handling
 * code wants to set this explicitly — Referer can be spoofed and isn't
 * always present.
 *
 * `bag` namespaces the errors. Default is the 'default' bag; pass a name
 * if you have multiple forms on the same page and need to keep their
 * errors separate.
 */
export async function validateOrRedirect<T>(
	options: ValidateOrRedirectOptions<T>,
): Promise<ValidateOrRedirectResult<T>> {
	const result = await options.validator()
	if (result.kind === 'ok') return { kind: 'ok', value: result.value }

	addErrors(options.ctx, result.errors, options.bag)

	if (options.flashTo) {
		await options.flashTo(options.ctx, readErrors(options.ctx) as Record<string, string>)
	}

	const target = options.redirectTo ?? options.ctx.req.header('Referer') ?? '/'
	return {
		kind: 'redirect',
		response: options.redirect({ ctx: options.ctx, url: target }),
	}
}