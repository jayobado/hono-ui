# hono-ui

[![JSR](https://jsr.io/badges/@jayobado/hono-ui)](https://jsr.io/@jayobado/hono-ui)

A Hono-based toolkit for composing UI and BFF applications. Auth, routes, Inertia.js, upstream HTTP — wired together by a single composer with canonical middleware ordering.

> **Status:** Personal/experimental (v0.1.0). API may change without notice. Use at your own risk.

## What this is

Hono-ui is a kit of composable primitives plus a thin composer. The kit decides the *shape* of a UI/BFF application (which middleware runs in what order, how auth integrates with upstream HTTP, how Inertia mounts); the application fills in the *values* (what cookies look like, which origins to trust, what your routes are).

Built around five primitives:

- **`createAuth`** — OAuth-refresh sessions, cookie I/O, credential relay
- **`createUpstream`** — HTTP client with auth-aware headers and timeouts
- **`createRoutes`** — Lightweight route declarations with Standard Schema validation
- **`createInertiaApp`** — [Inertia.js](https://inertiajs.com) protocol adapter
- **`createApp`** — The composer that wires everything together

Plus middleware factories (`requestId`, `accessLog`, `errorHandler`, `cors`, `bodyLimit`), runtime helpers (`serveDeno`, `serveNode`, `onShutdown`), and `mountHealth` for conventional `/health`, `/ready`, `/version` endpoints.

## What this isn't

- A full framework. Hono-ui composes Hono apps; it doesn't replace Hono. The composer returns a `Hono` instance you can extend.
- An ORM, query builder, or database adapter. Bring your own.
- A frontend bundler. Use Vite, esbuild, or whatever you prefer.
- Production-ready. This is personal infrastructure shared publicly.

## Design philosophy

**Conventions about shape, not specific values.** The kit declares which middleware exists in the lifecycle and in what order. Applications choose what fills each slot.

**No god-functions.** Each primitive is independent. The composer's behavior is exactly the sum of its inputs — no auto-discovery, no surprise defaults, no version-driven behavior changes.

**Frontend-neutral.** The kit doesn't pick a frontend stack. Inertia integration works with any of Inertia's frontends (Vue, React, Svelte).

**Runtime-portable.** Targets Deno, Node, and Cloudflare Workers (the last via `app.fetch` directly — no `serveCloudflare` helper, since Workers run handlers, not servers).

## Installation

### Deno

```sh
deno add jsr:@jayobado/hono-ui
```

Pin a version explicitly if you prefer:

```sh
deno add jsr:@jayobado/hono-ui@^0.1.0
```

You'll also need Hono itself:

```jsonc
// deno.json
{
  "imports": {
    "@jayobado/hono-ui": "jsr:@jayobado/hono-ui@^0.1.0",
    "hono": "npm:hono@^4.12.0",
    "hono/cookie": "npm:hono@^4.12.0/cookie"
  }
}
```

For route input validation, add Standard Schema and a compatible validator:

```jsonc
{
  "imports": {
    "@standard-schema/spec": "npm:@standard-schema/spec@^1",
    "zod": "npm:zod@^3"
  }
}
```

### Node

```sh
npm install @jayobado/hono-ui hono @hono/node-server
```

`@hono/node-server` is required for `serveNode` (the kit imports it dynamically only when that function is called).

For validation:

```sh
npm install @standard-schema/spec zod
```

### Bun

```sh
bun add @jayobado/hono-ui hono
```

Bun supports a `Bun.serve(app.fetch)` API. The kit doesn't ship a `serveBun` helper because the pattern is one line:

```ts
const app = createApp({ ... })
Bun.serve({ fetch: app.fetch, port: 3000 })
```

### Cloudflare Workers

Workers don't run long-lived servers — they invoke handlers per request. Hono-ui's `createApp` returns a Hono instance whose `fetch` method is the Workers entry point:

```ts
import { createApp } from '@jayobado/hono-ui'

const app = createApp({ ... })

export default {
  fetch: app.fetch,
}
```

`serveDeno`, `serveNode`, and `onShutdown` aren't used in Workers — the runtime invokes `fetch` directly and there's no long-running lifecycle to clean up.

For session storage on Workers, use Cloudflare KV or Durable Objects. A minimal KV-backed store:

```ts
import type { SessionStore, BaseSessionData } from '@jayobado/hono-ui/auth'

function createKvStore<S extends BaseSessionData>(kv: KVNamespace): SessionStore<S> {
  return {
    async get(id) {
      return (await kv.get(id, 'json') as S | null) ?? null
    },
    async set(id, data) {
      await kv.put(id, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 7 })
    },
    async delete(id) {
      await kv.delete(id)
    },
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const auth = createAuth({
      store: createKvStore(env.SESSIONS),
      credentials: { toHeaders: (s) => ({ Authorization: `Bearer ${s.accessToken}` }) },
    })
    const app = createApp({ auth, /* ... */ })
    return app.fetch(request, env)
  },
}
```

The factories run on every request, which is fine for small composition. For startup-cost-sensitive cases, move the instantiation to module scope.

## Quick start: Inertia BFF

```ts
import { createApp, createAuth, createInertiaApp, createRoutes, createUpstream } from '@jayobado/hono-ui'
import { createMemoryStore } from '@jayobado/hono-ui/auth'
import { requestId, accessLog, errorHandler, cors, bodyLimit } from '@jayobado/hono-ui/middleware'
import { renderRootView } from '@jayobado/hono-ui/inertia'
import { serveDeno, onShutdown } from '@jayobado/hono-ui/runtime'

type AppSession = {
  userId: string
  email: string
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

const auth = createAuth<AppSession>({
  store: createMemoryStore(),
  cookie: { name: 'sid', sameSite: 'Lax' },
  credentials: {
    toHeaders: (s) => ({ Authorization: `Bearer ${s.accessToken}` }),
  },
  refresh: {
    refresh: async (refreshToken) => {
      const res = await fetch('https://auth.example.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      })
      const data = await res.json()
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      }
    },
  },
})

const api = createUpstream({ baseUrl: 'https://api.example.com', auth })

const inertia = createInertiaApp({
  version: 'abc12345',
  renderRootView: renderRootView({ entry: '/assets/main.js' }),
  sharedProviders: [
    (c) => ({ auth: { user: auth.getSession(c) ?? null } }),
  ],
})

const routes = createRoutes()

routes.add({
  name: 'home',
  method: 'GET',
  path: '/',
  handler: (c) => inertia.render({ ctx: c, component: 'home' }),
})

routes.group({
  prefix: '/orders',
  guards: [auth.require()],
  routes: (r) => {
    r.add({
      name: 'orders.index',
      method: 'GET',
      path: '/',
      handler: async (c) => {
        const orders = await api.get(c, '/orders')
        return inertia.render({ ctx: c, component: 'orders.index', props: { orders } })
      },
    })

    r.add({
      name: 'orders.show',
      method: 'GET',
      path: '/:id',
      handler: async (c) => {
        const order = await api.get(c, `/orders/${c.req.param('id')}`)
        return inertia.render({ ctx: c, component: 'orders.show', props: { order } })
      },
    })
  },
})

const app = createApp({
  middleware: {
    requestId: requestId(),
    accessLog: accessLog(),
    errorHandler: errorHandler(),
    cors: cors({ origins: ['https://app.example.com'], credentials: true }),
    bodyLimit: bodyLimit({ max: 1024 * 1024 }),
  },
  auth,
  inertia,
  routes,
  health: { version: '1.0.0' },
})

onShutdown(async () => { /* cleanup */ })

await serveDeno(app, { port: 3000 })
```

## Quick start: REST API

Same composer, no Inertia, JSON responses:

```ts
import { createApp, createAuth, createRoutes, createUpstream } from '@jayobado/hono-ui'
import { createMemoryStore } from '@jayobado/hono-ui/auth'
import { requestId, accessLog, errorHandler, cors, bodyLimit } from '@jayobado/hono-ui/middleware'
import { serveDeno } from '@jayobado/hono-ui/runtime'
import { z } from 'zod'

const auth = createAuth({
  store: createMemoryStore(),
  credentials: { toHeaders: (s) => ({ Authorization: `Bearer ${s.accessToken}` }) },
})

const db = createUpstream({ baseUrl: 'https://db.example.com', auth })

const routes = createRoutes()

routes.group({
  prefix: '/orders',
  guards: [auth.require()],
  routes: (r) => {
    r.add({
      name: 'orders.list',
      method: 'GET',
      path: '/',
      handler: async (c) => {
        const orders = await db.get(c, '/orders')
        return c.json({ orders })
      },
    })

    r.add({
      name: 'orders.create',
      method: 'POST',
      path: '/',
      input: {
        body: z.object({
          customer: z.string().min(1),
          total: z.number().positive(),
        }),
      },
      handler: async (c, { body }) => {
        const order = await db.post(c, '/orders', body)
        return c.json({ order }, 201)
      },
    })

    r.add({
      name: 'orders.show',
      method: 'GET',
      path: '/:id',
      handler: async (c) => {
        const order = await db.get(c, `/orders/${c.req.param('id')}`)
        return c.json({ order })
      },
    })
  },
})

const app = createApp({
  middleware: {
    requestId: requestId(),
    accessLog: accessLog(),
    errorHandler: errorHandler(),
    cors: cors({ origins: ['https://app.example.com'] }),
    bodyLimit: bodyLimit({ max: 1024 * 1024 }),
  },
  auth,
  routes,
  routesPrefix: '/api',
  health: { version: '1.0.0' },
})

await serveDeno(app, { port: 3000 })
```

The differences from the Inertia example: no `inertia`, route handlers return `c.json(...)` instead of `inertia.render(...)`, and `routesPrefix: '/api'` mounts everything under `/api`.

## The composer

`createApp(config)` returns a Hono app with middleware mounted in canonical order:
1.  requestId         (correlation ID for everything below)
2.  errorHandler      (wraps everything below in try/catch)
3.  accessLog         (logs entry + exit)
4.  cors              (handle preflights before any handler)
5.  bodyLimit         (reject too-large bodies early)
6.  custom            (application-specific, before auth)
7.  health            (bypasses auth so health checks don't read sessions)
8.  auth              (loads session, refreshes if needed)
9.  inertia           (errors + shared bag setup)
10.  routes           (the application's route table)


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

## Inertia client setup

The server-side adapter (`createInertiaApp`) handles the protocol. The client side is plain Inertia.js with your chosen frontend framework. Two reference setups below.

### React

```sh
npm install @inertiajs/react react react-dom
```

```tsx
// client/main.tsx
import { createInertiaApp } from '@inertiajs/react'
import { createRoot } from 'react-dom/client'
import { resolvePageComponent } from './pages.ts'

createInertiaApp({
  resolve: (name) => resolvePageComponent(name),
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />)
  },
})
```

The kit's component naming convention is dot notation (`'orders.show'`). Map these to file imports however suits your project — most apps use Vite's glob import:

```ts
// client/pages.ts
import type { ComponentType } from 'react'

const pages = import.meta.glob<{ default: ComponentType }>('./pages/**/*.tsx')

export async function resolvePageComponent(name: string) {
  // 'orders.show' → './pages/orders/show.tsx'
  const path = `./pages/${name.replace(/\./g, '/')}.tsx`
  const loader = pages[path]
  if (!loader) throw new Error(`Page not found: ${name} (looked for ${path})`)
  return (await loader()).default
}
```

A page component:

```tsx
// client/pages/orders/show.tsx
import { Link, usePage } from '@inertiajs/react'

type Order = { id: string; customer: string; total: number }

type Props = {
  order: Order
}

export default function ShowOrder({ order }: Props) {
  const { auth } = usePage().props as { auth: { user: { email: string } | null } }

  return (
    <div>
      <h1>Order {order.id}</h1>
      <p>Customer: {order.customer}</p>
      <p>Total: ${order.total}</p>
      {auth.user && <p>Signed in as {auth.user.email}</p>}
      <Link href="/orders">Back to orders</Link>
    </div>
  )
}
```

Shared props from the server's `sharedProviders` (in this example, `auth`) appear on `usePage().props` for every page.

### Vue 3

```sh
npm install @inertiajs/vue3 vue
```

```ts
// client/main.ts
import { createInertiaApp } from '@inertiajs/vue3'
import { createApp, h, type Component } from 'vue'
import { resolvePageComponent } from './pages.ts'

createInertiaApp({
  resolve: (name) => resolvePageComponent(name),
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(App, props) }).use(plugin).mount(el)
  },
})
```

```ts
// client/pages.ts
import type { Component } from 'vue'

const pages = import.meta.glob<{ default: Component }>('./pages/**/*.vue')

export async function resolvePageComponent(name: string) {
  const path = `./pages/${name.replace(/\./g, '/')}.vue`
  const loader = pages[path]
  if (!loader) throw new Error(`Page not found: ${name} (looked for ${path})`)
  return (await loader()).default
}
```

A page component:

```vue
<!-- client/pages/orders/show.vue -->
<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3'

type Order = { id: string; customer: string; total: number }

defineProps<{ order: Order }>()

const page = usePage()
const auth = page.props.auth as { user: { email: string } | null }
</script>

<template>
  <div>
    <h1>Order {{ order.id }}</h1>
    <p>Customer: {{ order.customer }}</p>
    <p>Total: ${{ order.total }}</p>
    <p v-if="auth.user">Signed in as {{ auth.user.email }}</p>
    <Link href="/orders">Back to orders</Link>
  </div>
</template>
```

### Vue 3 with render functions

If you prefer render functions over single-file components — for a smaller toolchain, more explicit control, or to avoid the SFC compiler — Vue 3's `h()` API works directly with hono-ui. The setup, page resolution, and shared-data access are identical to the SFC version; only the component file format changes.

```ts
// client/main.ts
import { createInertiaApp } from '@inertiajs/vue3'
import { createApp, h } from 'vue'
import { resolvePageComponent } from './pages.ts'

createInertiaApp({
  resolve: (name) => resolvePageComponent(name),
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(App, props) }).use(plugin).mount(el)
  },
})
```

```ts
// client/pages.ts
import type { Component } from 'vue'

// Files are .ts instead of .vue
const pages = import.meta.glob<{ default: Component }>('./pages/**/*.ts')

export async function resolvePageComponent(name: string) {
  const path = `./pages/${name.replace(/\./g, '/')}.ts`
  const loader = pages[path]
  if (!loader) throw new Error(`Page not found: ${name} (looked for ${path})`)
  return (await loader()).default
}
```

A page component:

```ts
// client/pages/orders/show.ts
import { defineComponent, h } from 'vue'
import { Link, usePage } from '@inertiajs/vue3'

type Order = { id: string; customer: string; total: number }
type AuthUser = { email: string } | null

export default defineComponent({
  props: {
    order: { type: Object as () => Order, required: true },
  },
  setup(props) {
    const page = usePage()
    const auth = () => page.props.auth as { user: AuthUser }

    return () =>
      h('div', null, [
        h('h1', null, `Order ${props.order.id}`),
        h('p', null, `Customer: ${props.order.customer}`),
        h('p', null, `Total: $${props.order.total}`),
        auth().user && h('p', null, `Signed in as ${auth().user!.email}`),
        h(Link, { href: '/orders' }, () => 'Back to orders'),
      ])
  },
})
```

Reading this against the SFC version, three things are different:

1. **The file is `.ts`, not `.vue`.** No SFC compiler step needed. Vite (or whatever bundler) treats it as plain TypeScript.
2. **Templates become `h()` calls.** Each element is `h(tag, props, children)`. `Link`, `usePage`, and other Inertia helpers work identically — they're just imported and called from the setup function.
3. **Props are declared via `defineComponent`.** Type the props explicitly with `Object as () => YourType` since render functions don't have a template compiler to infer them.

The trade-offs are real but small: render functions are more verbose for static-heavy markup; they're equivalent or shorter for dynamic content with conditionals and loops. If you've built UIs with React's JSX or with `h()`-style libraries before, this will feel familiar.

For larger pages, a small helper makes the markup denser:

```ts
import { h, type VNode } from 'vue'

const div = (props: any, ...children: any[]) => h('div', props, children)
const p = (...children: any[]) => h('p', null, children)
const h1 = (text: string) => h('h1', null, text)

// Then:
return () =>
  div(null,
    h1(`Order ${props.order.id}`),
    p(`Customer: ${props.order.customer}`),
    p(`Total: $${props.order.total}`),
  )
```

The kit doesn't ship these helpers — they're trivial enough to write per-project and the right shape depends on your aesthetic preferences.

### The HTML shell

Both frameworks need an HTML entry point that hono-ui's `renderRootView` produces. The server-side `entry` path points to the bundled JS file (Vite produces it from `client/main.tsx` or `client/main.ts`):

```ts
const inertia = createInertiaApp({
  version: 'abc12345',
  renderRootView: renderRootView({ entry: '/assets/main.js' }),
  sharedProviders: [
    (c) => ({ auth: { user: auth.getSession(c) ?? null } }),
  ],
})
```

For development, point `entry` at Vite's dev server (`http://localhost:5173/client/main.tsx`). For production, point at the built file (`/assets/main.<hash>.js` derived from your build manifest).

### Build setup

A minimal `vite.config.ts` for either framework:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'  // or @vitejs/plugin-vue

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    rollupOptions: {
      input: './client/main.tsx',  // or main.ts for Vue
    },
    outDir: './dist',
  },
})
```

The manifest output (`dist/.vite/manifest.json`) gives you the hashed asset paths to feed into `renderRootView`'s `entry` option and to derive your Inertia version from.

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