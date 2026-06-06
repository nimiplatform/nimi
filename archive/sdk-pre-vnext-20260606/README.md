# @nimiplatform/sdk

TypeScript SDK for Nimi apps and integrations.

`@nimiplatform/sdk` provides the public client surface for Realm services,
local Runtime access, Nimi App runtime projection, shared SDK types, scope
helpers, and the Vercel AI SDK provider adapter. Product authority remains in
`.nimi/spec/**`; this package is the typed application boundary for consumers.

## Install

```bash
pnpm add @nimiplatform/sdk
```

## Quick Start

Use the root package for app-level composition:

```ts
import { createPlatformClient } from '@nimiplatform/sdk';

const platform = createPlatformClient({
  realm: { baseUrl: 'https://api.nimi.ai' },
  runtime: { endpoint: 'http://127.0.0.1:7345' },
});
```

Generated third-party Nimi App scaffolds use the app-runtime projection helper:

```ts
import { createNimiAppRuntimePlatformClient } from '@nimiplatform/sdk';

const projection = await createNimiAppRuntimePlatformClient({
  mode: 'third-party-nimi-app',
  appId: 'my-nimi-app',
});
```

## Public Subpaths

- `@nimiplatform/sdk` — app-level composition entry
- `@nimiplatform/sdk/app` — Nimi App auth and runtime projection types
- `@nimiplatform/sdk/realm` — Realm cloud state integration
- `@nimiplatform/sdk/runtime` — Runtime Node/gRPC transport
- `@nimiplatform/sdk/runtime/browser` — Runtime browser transport
- `@nimiplatform/sdk/types` — shared type definitions
- `@nimiplatform/sdk/scope` — scope and capability helpers
- `@nimiplatform/sdk/ai-provider` — Vercel AI SDK provider adapter
- `@nimiplatform/sdk/world` — world-facing SDK types and helpers

## Runtime Example

```ts
import { createRuntimeClient } from '@nimiplatform/sdk/runtime';

const runtime = createRuntimeClient({
  endpoint: 'http://127.0.0.1:7345',
});

const result = await runtime.ai.text.generate({
  prompt: 'Write a one sentence greeting from Nimi.',
});
```

## Package Boundaries

- Use `createPlatformClient()` for app-level composition.
- Use `createNimiAppRuntimePlatformClient()` in third-party Nimi App
  scaffolds that need the admitted Runtime app projection.
- Use subpath imports only when a consumer intentionally targets a narrower
  Realm, Runtime, scope, app, or provider surface.
- Do not import generated or private deep paths.

## Verification

```bash
pnpm --filter @nimiplatform/sdk build
pnpm --filter @nimiplatform/sdk test
```
