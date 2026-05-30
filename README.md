Each slot is optional. Configure only what you need.

For middleware not covered by the lifecycle slots, use `custom`:

```ts
createApp({
  middleware: {
    requestId: requestId(),
    custom: [rateLimit(), featureFlags()],
  },
  // ...
})
```

For middleware that needs to run *after* auth (logging authenticated user actions, etc.), attach it to the returned Hono app:

```ts
const app = createApp({ ... })
app.use('*', auditUserActions())
```

## Auth

The `createAuth` factory produces an `Auth` instance modeled on the OAuth-refresh BFF pattern: the BFF holds the user's access and refresh tokens in a server-side session, attaches the access token to upstream requests, and refreshes proactively before expiry.

```ts
import { createAuth, createMemoryStore } from '@jayobado/hono-ui/auth'

const auth = createAuth<MySession>({
  store: createMemoryStore(),
  cookie: { name: 'sid', sameSite: 'Lax', secure: true },
  credentials: {
    toHeaders: (session) => ({ Authorization: `Bearer ${session.accessToken}` }),
    forwardCookies: ['stripe-session'],
  },
  refresh: {
    refresh: async (refreshToken) => ({
      accessToken: '...',
      refreshToken: '...',
      expiresAt: Date.now() + 3600_000,
    }),
    graceSeconds: 60,
  },
})

// Usage in handlers:
auth.getSession(c)                          // → S | null
auth.login(c, sessionData)                  // → string (session ID)
auth.logout(c)                              // → void
auth.require()                              // → middleware guard
auth.require({ redirectTo: '/login' })      // → guard with redirect on missing session
```

Custom session storage: implement the `SessionStore<S>` interface (three methods: `get`, `set`, `delete`). The memory store is for development; production apps use Redis, Postgres, or KV stores.

## Upstream

`createUpstream` produces an HTTP client that automatically attaches auth credentials and applies a base URL.

```ts
import { createUpstream } from '@jayobado/hono-ui/upstream'

const api = createUpstream({
  baseUrl: 'https://api.example.com',
  auth,
  defaultHeaders: { Accept: 'application/json' },
  timeoutMs: 10000,
})

// REST convenience (parses JSON, throws UpstreamError on non-2xx)
const orders = await api.get(c, '/orders')
const created = await api.post(c, '/orders', { customer: 'Acme' })

// Raw fetch — for streaming, binary, non-REST protocols
const stream = await api.fetch(c, '/events', { timeoutMs: 0 })

// Header builder — for use with non-REST clients
const headers = api.headers(c)
```

### Multiple backends with different auth

```ts
const userApi = createUpstream({ baseUrl: 'https://api.example.com', auth })

const billingApi = createUpstream({
  baseUrl: 'https://api.billing.com',
  defaultHeaders: { Authorization: `Bearer ${Deno.env.get('BILLING_KEY')}` },
})

const analyticsApi = createUpstream({
  baseUrl: 'https://api.analytics.com',
  auth,
  credentials: {
    toHeaders: (session) => ({ Authorization: `Bearer ${session.analyticsToken}` }),
  },
})
```

## Routes

`createRoutes` produces a route table. Routes are added imperatively, can be grouped with shared prefixes and guards, and have type-safe URL generation.

```ts
import { createRoutes } from '@jayobado/hono-ui/route'
import { z } from 'zod'

const routes = createRoutes()

routes.add({
  name: 'home',
  method: 'GET',
  path: '/',
  handler: (c) => c.text('hello'),
})

// With validation — handler receives typed input
routes.add({
  name: 'orders.create',
  method: 'POST',
  path: '/orders',
  input: {
    body: z.object({ customer: z.string(), total: z.number().positive() }),
  },
  handler: async (c, { body }) => {
    // body is typed { customer: string; total: number }
    return c.json({ created: true })
  },
})

// Groups — shared prefix and guards
routes.group({
  prefix: '/admin',
  guards: [auth.require({ role: 'admin' })],
  routes: (r) => {
    r.add({ name: 'admin.dashboard', method: 'GET', path: '/dashboard', handler: ... })
    r.add({ name: 'admin.users', method: 'GET', path: '/users', handler: ... })
  },
})

// URL generation
routes.url('orders.create')                    // → '/orders'
routes.url('orders.show', { id: 123 })         // → '/orders/123'
```

URL generation is runtime-only — typos throw at the call site rather than failing TypeScript compilation. The error message includes the list of known route names for quick diagnosis.

Validation uses [Standard Schema](https://standardschema.dev), so any compatible library works (Zod, Valibot, ArkType).

## Inertia.js

Hono-ui includes a complete Inertia.js protocol adapter. The `createInertiaApp` factory returns an `inertia` instance with eight methods, all taking single options objects.

```ts
import { createInertiaApp, renderRootView, lazy, optional, defer } from '@jayobado/hono-ui/inertia'

const inertia = createInertiaApp({
  version: '...',
  renderRootView: renderRootView({ entry: '/assets/main.js' }),
  sharedProviders: [
    (c) => ({ auth: { user: auth.getSession(c) ?? null } }),
  ],
})

inertia.render({
  ctx: c,
  component: 'orders.show',
  props: {
    order,
    comments: lazy(() => fetchComments()),
    stats: optional(() => computeStats()),
    activity: defer(() => recentActivity(), 'lower'),
  },
  viewData: { title: `Order ${order.id}` },
  cache: 60,
})

inertia.redirect({ ctx: c, url: '/orders' })
inertia.location({ url: 'https://stripe.com' })

inertia.share({ ctx: c, key: 'breadcrumb', value: ['Home', 'Orders'] })
inertia.addError({ ctx: c, field: 'email', message: 'required' })
inertia.addErrors({ ctx: c, errors: { email: 'required' } })
const errors = inertia.readErrors({ ctx: c })
```

The adapter handles version negotiation, partial reloads, deferred props, flashed errors, SSR slots, and 302→303 conversion for mutating verbs. See [Inertia's docs](https://inertiajs.com/the-protocol) for protocol details.

## Non-REST protocols

The kit's REST convenience methods (`api.get`, `api.post`, etc.) cover most BFF needs. For other protocols, use `api.fetch` for raw HTTP or `api.headers(c)` to get auth-attached headers for use with ecosystem clients.

### Connect-RPC and gRPC-web

The [Connect](https://connectrpc.com) ecosystem's clients accept a custom `fetch` function. Wrap the global `fetch` to inject hono-ui's headers:

```ts
import { createPromiseClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { OrdersService } from './gen/orders_connect.ts'

function ordersClient(ctx: Context) {
  return createPromiseClient(OrdersService, createConnectTransport({
    baseUrl: 'https://api.example.com',
    fetch: (input, init) => fetch(input, {
      ...init,
      headers: { ...init?.headers, ...api.headers(ctx) },
    }),
  }))
}

routes.add({
  name: 'orders.index',
  method: 'GET',
  path: '/orders',
  guards: [auth.require()],
  handler: async (c) => {
    const client = ordersClient(c)
    const { orders } = await client.listOrders({})
    return c.json({ orders })
  },
})
```

Swap `createConnectTransport` for `createGrpcWebTransport` to use the gRPC-web transport with the same client API.

### tRPC — HTTP client

```ts
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../shared/router.ts'

function trpcClient(ctx: Context) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: 'https://api.example.com/trpc',
        headers: () => api.headers(ctx),
      }),
    ],
  })
}

routes.add({
  name: 'orders.index',
  method: 'GET',
  path: '/orders',
  guards: [auth.require()],
  handler: async (c) => {
    const trpc = trpcClient(c)
    const orders = await trpc.orders.list.query({ userId: getUser(c).id })
    return c.json({ orders })
  },
})
```

### tRPC — server-side caller

When the BFF *defines* its own tRPC router, server-side handlers can call procedures directly without HTTP:

```ts
// shared/router.ts
import { initTRPC } from '@trpc/server'
import { z } from 'zod'

const t = initTRPC.context<{ userId: string }>().create()

export const appRouter = t.router({
  orders: t.router({
    list: t.procedure
      .input(z.object({ userId: z.string() }))
      .query(({ input }) => db.listOrders(input.userId)),
  }),
})

export const createCaller = t.createCallerFactory(appRouter)
export type AppRouter = typeof appRouter

// In your routes file:
import { createCaller } from '../shared/router.ts'

routes.add({
  name: 'orders.index',
  method: 'GET',
  path: '/orders',
  guards: [auth.require()],
  handler: async (c) => {
    const session = auth.getSession(c)!
    const caller = createCaller({ userId: session.userId })

    // Calls the procedure directly — no HTTP, fully typed
    const orders = await caller.orders.list({ userId: session.userId })

    return inertia.render({ ctx: c, component: 'orders.index', props: { orders } })
  },
})
```

Same procedure, two callers: HTTP-transport client for cross-service calls, in-process caller for internal logic sharing.

### GraphQL

```ts
import { UpstreamError } from '@jayobado/hono-ui/upstream'

async function graphql<T>(
  ctx: Context,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await api.fetch(ctx, '/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new UpstreamError(`HTTP ${response.status}`, {
      status: response.status, url: '/graphql', method: 'POST',
    })
  }

  const body = await response.json()
  if (body.errors) {
    throw new UpstreamError('GraphQL errors', {
      url: '/graphql', method: 'POST', body: body.errors,
    })
  }
  return body.data as T
}

routes.add({
  name: 'orders.index',
  method: 'GET',
  path: '/orders',
  guards: [auth.require()],
  handler: async (c) => {
    const data = await graphql<{ orders: Order[] }>(c, `
      query GetOrders($userId: ID!) {
        orders(userId: $userId) { id total }
      }
    `, { userId: getUser(c).id })

    return c.json({ orders: data.orders })
  },
})
```

### Streaming

Pass `timeoutMs: 0` to disable the default 30-second timeout for long-lived connections:

```ts
routes.add({
  name: 'orders.live',
  method: 'GET',
  path: '/live/orders',
  guards: [auth.require()],
  handler: async (c) => {
    const upstream = await api.fetch(c, '/orders/stream', { timeoutMs: 0 })
    return upstream  // Hono streams the response through to the browser
  },
})
```

## Middleware

Five lifecycle middleware factories. Each takes options; the composer decides ordering.

- **`requestId()`** — Generates or propagates `X-Request-Id` headers
- **`accessLog()`** — Structured request/response logging
- **`errorHandler()`** — Catches thrown errors, produces consistent error responses
- **`cors()`** — CORS preflight and origin validation (no `*` default; `origins` is required)
- **`bodyLimit()`** — Reject requests with bodies larger than `max` bytes (required)

Each has options for customizing behavior — see source files for details.

## Health endpoints

```ts
import { mountHealth } from '@jayobado/hono-ui'

mountHealth(app, {
  version: '1.0.0',
  commit: 'abc12345',
  builtAt: '2026-05-30T08:00:00Z',
  ready: async () => {
    await db.ping()
    return true
  },
})
```

Or as a composer slot:

```ts
createApp({
  health: { version: '1.0.0', ready: () => db.ping() },
  // ...
})
```

Three endpoints mount automatically: `/health` (liveness), `/ready` (readiness, returns 503 on failure), `/version` (build metadata).

## Runtime helpers

```ts
import { serveDeno, serveNode, onShutdown } from '@jayobado/hono-ui/runtime'

const app = createApp({ ... })

onShutdown(async () => {
  await db.close()
  logger.flush()
})

// Deno
await serveDeno(app, { port: 3000, shutdownTimeoutMs: 30000 })

// Node
await serveNode(app, { port: 3000 })
```

Each `serve*` function throws if called on the wrong runtime. SIGTERM/SIGINT handlers are registered automatically — they drain the HTTP server, run `onShutdown` callbacks, then exit.

For Cloudflare Workers, use the composer's `app.fetch` directly:

```ts
const app = createApp({ ... })
export default { fetch: app.fetch }
```

## Subpaths

```ts
import { createApp, mountHealth }                              from '@jayobado/hono-ui'
import { requestId, accessLog, errorHandler, cors, bodyLimit } from '@jayobado/hono-ui/middleware'
import { createAuth, createMemoryStore }                       from '@jayobado/hono-ui/auth'
import { createInertiaApp, renderRootView, lazy, optional }    from '@jayobado/hono-ui/inertia'
import { createRoutes }                                        from '@jayobado/hono-ui/route'
import { createUpstream, UpstreamError }                       from '@jayobado/hono-ui/upstream'
import { serveDeno, onShutdown }                               from '@jayobado/hono-ui/runtime'
```

## License

MIT. See [LICENSE](LICENSE).