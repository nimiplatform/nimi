# SDK

The Nimi SDK is the app-facing boundary for Runtime, Realm, AI, agent,
feature, and shared-type consumption. The active implementation lives under
`sdks/typescript` and is the next major `@nimiplatform/sdk`.

Apps should start from the root package:

```ts
import { createNimiClient } from '@nimiplatform/sdk';
```

The root client composes admitted Runtime and Realm surfaces with app identity.
Dedicated subpaths remain available for lower-level or domain-specific use.

## What This Section Contains

- [Boundaries](/sdk/boundaries) — the import and call rules apps must follow.
- [Runtime Client](/sdk/runtime-client) — the public app path into Runtime.
- [Realm And Composition](/sdk/realm-world-client) — Realm truth and admitted
  world-facing composition without restoring `@nimiplatform/sdk/world`.
- [Adapters](/sdk/adapters) — external framework adapters such as
  `@nimiplatform/sdk-adapter-vercel-ai`.
- [Shared Types](/sdk/types) — portable public types and errors.

## Public Surface Set

The vNext TypeScript package has one base SDK package. External framework
adapters are independent packages, not base SDK subpaths.

| Public entry | Role |
| --- | --- |
| `@nimiplatform/sdk` | Recommended app-level composition surface |
| `@nimiplatform/sdk/runtime` | Runtime facade and typed Runtime projection |
| `@nimiplatform/sdk/realm` | Realm facade and generated Realm client boundary |
| `@nimiplatform/sdk/app` | App identity and app-facing helpers |
| `@nimiplatform/sdk/types` | Shared public types and SDK errors |
| `@nimiplatform/sdk/contracts` | Public contract descriptors |
| `@nimiplatform/sdk/ai` | Native AI model generation surface |
| `@nimiplatform/sdk/agent` | Agent identity and runner surface |
| `@nimiplatform/sdk/testing` | Test helpers for SDK consumers |
| `@nimiplatform/sdk/features/*` | Feature-level modules for conversation, generation, workflow, evaluation, knowledge context, memory context, and toolkits |

The removed legacy subpaths must fail closed: `@nimiplatform/sdk/world`,
`@nimiplatform/sdk/scope`, `@nimiplatform/sdk/ai-provider`,
`@nimiplatform/sdk/ai-app`, and old runtime compatibility subpaths are not
forwarded.

## Why The SDK Exists

Nimi has multiple authority domains. Runtime owns execution. Realm owns
semantic truth. Desktop owns native shell behavior. Cognition owns standalone
memory and knowledge authority. Application code needs a stable way to use
those domains without importing their private implementation.

The SDK is that boundary. It projects admitted owner-domain behavior into
developer-facing TypeScript APIs. It does not invent Runtime, Realm, Desktop,
or Cognition truth.

## Reader Scenario: A First Integration

An app that needs Realm data and Runtime-backed generation should:

1. Create a root client with explicit app identity.
2. Read Realm data through `client.realm` or `@nimiplatform/sdk/realm`.
3. Run Runtime work through `client.runtime`, `@nimiplatform/sdk/runtime`, or
   native `@nimiplatform/sdk/ai` helpers.
4. Use `@nimiplatform/sdk/features/*` only when the feature contract matches
   the workflow.
5. Keep portable ids, reason codes, and public errors in
   `@nimiplatform/sdk/types`.

That app does not import Runtime internals, Realm REST routes, or removed SDK
compatibility paths.

## Source Basis

- [`.nimi/spec/sdks/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/index.md)
- [`.nimi/spec/sdks/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/index.md)
- [`.nimi/spec/sdks/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/surface-contract.md)
- [`.nimi/spec/sdks/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/boundary-contract.md)
- [`.nimi/spec/sdks/kernel/typescript-vnext-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/typescript-vnext-contract.md)
- [`.nimi/spec/sdks/kernel/tables/typescript-target-export-map.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/tables/typescript-target-export-map.yaml)
