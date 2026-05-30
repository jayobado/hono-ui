import { Hono, type MiddlewareHandler, type Context } from 'hono'
import type { StandardSchemaV1 } from '@standard-schema/spec'

// ─── Types ──────────────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

/**
 * Validated input passed as the second argument to handlers. Each field is
 * present iff the corresponding validator was declared in `input`. The kit
 * uses Standard Schema's InferOutput to type these from the validator types.
 */
export type ValidatedInput<I extends RouteInput | undefined> = I extends RouteInput
	? {
		body: I['body'] extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<I['body']> : never
		query: I['query'] extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<I['query']> : never
		params: I['params'] extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<I['params']> : never
		headers: I['headers'] extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<I['headers']> : never
	}
	: Record<string, never>

export type RouteInput = {
	body?: StandardSchemaV1
	query?: StandardSchemaV1
	params?: StandardSchemaV1
	headers?: StandardSchemaV1
}

export type ValidationIssue = {
	source: 'body' | 'query' | 'params' | 'headers'
	path: ReadonlyArray<PropertyKey>
	message: string
}

export type RouteHandler<I extends RouteInput | undefined = undefined> =
	(ctx: Context, input: ValidatedInput<I>) => Response | Promise<Response>

export type RouteDescriptor<I extends RouteInput | undefined = undefined> = {
	name?: string
	method: HttpMethod
	path: string
	handler: RouteHandler<I>
	/** Middleware run before validation; use for auth.require(), feature flags, etc. */
	guards?: MiddlewareHandler[]
	/** Standard Schema validators for body/query/params/headers. */
	input?: I
	/** Convert validation failures to a Response. Default: 422 JSON with the issues. */
	onValidationError?: (ctx: Context, issues: ValidationIssue[]) => Response | Promise<Response>
}

export type GroupConfig = {
	prefix?: string
	guards?: MiddlewareHandler[]
	routes: (r: Routes) => void
}

export type Routes = {
	/** Register a single route. */
	add<I extends RouteInput | undefined = undefined>(descriptor: RouteDescriptor<I>): void
	/** Create a prefix/guards-scoped group of routes. */
	group(config: GroupConfig): void
	/** Generate a URL from a registered route name. Throws if the name is unknown. */
	url(name: string, params?: Record<string, string | number>): string
	/** Return the registered route descriptors (final paths and guards applied). */
	list(): ReadonlyArray<RegisteredRoute>
	/** Build a Hono sub-app from the registered routes. Called by createUiApp. */
	build(): Hono
}

/**
 * Internal — a descriptor after all group prefixes and guards are applied.
 * The `list()` method returns these so applications can inspect the resolved
 * route table.
 */
export type RegisteredRoute = {
	name?: string
	method: HttpMethod
	path: string
	guards: ReadonlyArray<MiddlewareHandler>
	hasInput: boolean
}

// ─── Implementation ─────────────────────────────────────────────────────────

type StoredRoute = {
	name?: string
	method: HttpMethod
	path: string
	guards: MiddlewareHandler[]
	handler: RouteHandler<RouteInput | undefined>
	input?: RouteInput
	onValidationError?: (ctx: Context, issues: ValidationIssue[]) => Response | Promise<Response>
}

export function createRoutes(): Routes {
	const stored: StoredRoute[] = []
	return createRoutesScope(stored, '', [])
}

function createRoutesScope(
	stored: StoredRoute[],
	parentPrefix: string,
	parentGuards: MiddlewareHandler[],
): Routes {
	const self: Routes = {
		add(descriptor) {
			stored.push({
				name: descriptor.name,
				method: descriptor.method,
				path: joinPath(parentPrefix, descriptor.path),
				guards: [...parentGuards, ...(descriptor.guards ?? [])],
				handler: descriptor.handler as RouteHandler<RouteInput | undefined>,
				input: descriptor.input,
				onValidationError: descriptor.onValidationError,
			})
		},

		group(config) {
			const child = createRoutesScope(
				stored,
				joinPath(parentPrefix, config.prefix ?? ''),
				[...parentGuards, ...(config.guards ?? [])],
			)
			config.routes(child)
		},

		url(name, params = {}) {
			const route = stored.find((r) => r.name === name)
			if (!route) {
				const known = stored.filter((r) => r.name).map((r) => r.name).join(', ')
				throw new Error(`Unknown route name: '${name}'. Known names: ${known || '(none registered)'}`)
			}
			return interpolatePath(route.path, params)
		},

		list() {
			return stored.map((r) => ({
				name: r.name,
				method: r.method,
				path: r.path,
				guards: r.guards,
				hasInput: r.input !== undefined,
			}))
		},

		build() {
			const app = new Hono()
			for (const route of stored) {
				mountRoute(app, route)
			}
			return app
		},
	}
	return self
}

// ─── Path utilities ─────────────────────────────────────────────────────────

function joinPath(a: string, b: string): string {
	if (!a) return b.startsWith('/') ? b : `/${b}`
	if (!b) return a
	const left = a.replace(/\/$/, '')
	const right = b.startsWith('/') ? b : `/${b}`
	return left + right
}

function interpolatePath(path: string, params: Record<string, string | number>): string {
	let result = path
	for (const [key, value] of Object.entries(params)) {
		result = result.replace(`:${key}`, encodeURIComponent(String(value)))
	}
	if (/:[a-zA-Z]/.test(result)) {
		throw new Error(`Missing params when generating URL for '${path}': result was '${result}'`)
	}
	return result
}

// ─── Route mounting ─────────────────────────────────────────────────────────
function mountRoute(app: Hono, route: StoredRoute): void {
	const validateAndHandle: MiddlewareHandler = async (ctx, _next) => {
		const validation = await validateInput(ctx, route.input)
		if (validation.kind === 'errors') {
			if (route.onValidationError) {
				return await route.onValidationError(ctx, validation.issues)
			}
			return defaultValidationErrorResponse(validation.issues)
		}
		return await route.handler(ctx, validation.input as ValidatedInput<RouteInput | undefined>)
	}

	// Attach guards via .use() so they only run for this route's path
	for (const guard of route.guards) {
		app.use(route.path, guard)
	}

	// Mount the route handler via .on() which accepts any HTTP method
	app.on(route.method, route.path, validateAndHandle)
}

// ─── Validation ─────────────────────────────────────────────────────────────

type ValidationOutcome =
	| { kind: 'ok'; input: Record<string, unknown> }
	| { kind: 'errors'; issues: ValidationIssue[] }

async function validateInput(
	ctx: Context,
	input: RouteInput | undefined,
): Promise<ValidationOutcome> {
	if (!input) return { kind: 'ok', input: {} }

	const issues: ValidationIssue[] = []
	const out: Record<string, unknown> = {}

	if (input.body) {
		const raw = await readBody(ctx)
		const result = await runValidator(input.body, raw)
		if (result.kind === 'errors') {
			issues.push(...result.issues.map((i) => ({ ...i, source: 'body' as const })))
		} else {
			out.body = result.value
		}
	}

	if (input.query) {
		const raw = Object.fromEntries(new URL(ctx.req.url).searchParams.entries())
		const result = await runValidator(input.query, raw)
		if (result.kind === 'errors') {
			issues.push(...result.issues.map((i) => ({ ...i, source: 'query' as const })))
		} else {
			out.query = result.value
		}
	}

	if (input.params) {
		const raw = ctx.req.param()
		const result = await runValidator(input.params, raw)
		if (result.kind === 'errors') {
			issues.push(...result.issues.map((i) => ({ ...i, source: 'params' as const })))
		} else {
			out.params = result.value
		}
	}

	if (input.headers) {
		const raw: Record<string, string> = {}
		for (const [k, v] of ctx.req.raw.headers.entries()) {
			raw[k] = v
		}
		const result = await runValidator(input.headers, raw)
		if (result.kind === 'errors') {
			issues.push(...result.issues.map((i) => ({ ...i, source: 'headers' as const })))
		} else {
			out.headers = result.value
		}
	}

	if (issues.length > 0) return { kind: 'errors', issues }
	return { kind: 'ok', input: out }
}

async function readBody(ctx: Context): Promise<unknown> {
	const contentType = ctx.req.header('Content-Type') ?? ''
	if (contentType.includes('application/json')) {
		try { return await ctx.req.json() } catch { return undefined }
	}
	if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
		try { return Object.fromEntries((await ctx.req.formData()).entries()) } catch { return undefined }
	}
	// Default: try JSON, fall through to undefined
	try { return await ctx.req.json() } catch { return undefined }
}

type ValidatorResult =
	| { kind: 'ok'; value: unknown }
	| { kind: 'errors'; issues: Array<{ path: ReadonlyArray<PropertyKey>; message: string }> }

async function runValidator(schema: StandardSchemaV1, data: unknown): Promise<ValidatorResult> {
	const result = await schema['~standard'].validate(data)
	if (result.issues) {
		return {
			kind: 'errors',
			issues: result.issues.map((i) => ({
				path: i.path?.map((p) => (typeof p === 'object' ? p.key : p)) ?? [],
				message: i.message,
			})),
		}
	}
	return { kind: 'ok', value: result.value }
}

function defaultValidationErrorResponse(issues: ValidationIssue[]): Response {
	return new Response(
		JSON.stringify({ error: { message: 'Validation failed', issues } }),
		{ status: 422, headers: { 'Content-Type': 'application/json' } },
	)
}