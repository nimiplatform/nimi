---
aside: false
---

# SDK

The Nimi SDK is the app-facing boundary for Runtime, Realm, AI, agent,
feature, and shared-type consumption. The active implementation lives under
`sdks/typescript` and is the public `@nimiplatform/sdk` package.

## Start Here: A Nimi App

A Nimi App uses one host-bound client. Nimi Home launches the App in a
supervised Host, the Host injects the standard shell, and Runtime derives the
account, the App identity, and its access from that protected session. The App
supplies no App ID, account, token, or Runtime endpoint.

```ts
import { createNimiClient, type NimiLocalAppClient } from '@nimiplatform/sdk';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

let client: NimiLocalAppClient | null = null;

export function getNimiLocalAppClient(): NimiLocalAppClient {
  client ??= createNimiClient({
    localApp: { standardShell: createNimiLocalAppStandardShellSurface() },
  });
  return client;
}
```

A project created with App Tools already contains this client in
`src/shell/auth/local-app-client.ts`; reuse it. Then make your
[First AI Call](/sdk/first-ai-call) through it.

## Other Entry Points And Who They Are For

| Entry | Use it when |
| --- | --- |
| `client.ai.text.generateCandidate` | An App needs one text answer. [First AI Call](/sdk/first-ai-call) walks through it. |
| `client.aiConfig` | An App reads or saves its own capability intent. See [AI Config](/sdk/ai-config-surface). |
| `createNimiLocalAppTextModel(client.ai)` from `@nimiplatform/sdk/ai` | An App runs its own multi-step tool loop, needs JSON output, or sends image parts. It uses the same host-bound client. |
| `createNimiLocalAppVercelLanguageModel({ ai: client.ai })` from `@nimiplatform/sdk-adapter-vercel-ai` | An App is built on Vercel AI SDK 6. It is a separate package; check its release pairing in [Adapters](/sdk/adapters). |
| `createNimiClient({ appId, runtime, realm })` | A program outside the Nimi App surface, such as a script that signs in to Realm itself and stores its own tokens. |

The last entry returns a direct `NimiClient`, not an App client. An App ID in
its configuration grants no access. Over a plain loopback gRPC connection,
Runtime rejects App-scoped operations such as AI execution and Jobs, App
AIConfig, App storage, and Agent Conversation with
`PROTECTED_ORIGIN_ROLE_MISMATCH`. Do not replace an App's host-bound client
with it.

## Surfaces

<SdkSurfaces />

## What This Section Contains

- [Boundaries](/sdk/boundaries) — the import and call rules apps must follow.
- [First AI Call](/sdk/first-ai-call) — one text generation through the
  App's host-bound client.
- [AI Config](/sdk/ai-config-surface) — an App's own capability intent.
- [Runtime Client](/sdk/runtime-client) — the typed Runtime projection and
  its supported consumer contexts.
- [Realm And Composition](/sdk/realm-world-client) — Realm truth and admitted
  world-facing composition without restoring `@nimiplatform/sdk/world`.
- [Adapters](/sdk/adapters) — external framework adapters such as
  `@nimiplatform/sdk-adapter-vercel-ai`.
- [Shared Types](/sdk/types) — portable public types and errors.

## Public Surface Set

The TypeScript SDK has one base package. External framework
adapters are independent packages, not base SDK subpaths.

| Public entry | Role |
| --- | --- |
| `@nimiplatform/sdk` | `createNimiClient` and the shared public exports; Apps create their host-bound client here |
| `@nimiplatform/sdk/app` | Host-bound App client, standard shell contracts, and typed App operations |
| `@nimiplatform/sdk/ai` | Model interfaces, including the App text model binding |
| `@nimiplatform/sdk/runtime` | Typed Runtime clients for their supported consumer contexts; not an App authorization bypass |
| `@nimiplatform/sdk/realm` | Realm clients for independently authenticated programs; Apps use Realm operations on their App client |
| `@nimiplatform/sdk/types` | Shared public types and SDK errors |
| `@nimiplatform/sdk/contracts` | Public contract descriptors |
| `@nimiplatform/sdk/ai-runner` | Framework-neutral AI runner facade |
| `@nimiplatform/sdk/testing` | Test helpers for SDK consumers |
| `@nimiplatform/sdk/features/*` | Demand-driven feature modules backed by a concrete consumer contract |

The removed subpaths must fail closed: `@nimiplatform/sdk/world`,
`@nimiplatform/sdk/scope`, `@nimiplatform/sdk/ai-provider`,
`@nimiplatform/sdk/ai-app`, and old runtime compatibility subpaths are not
forwarded.

## Why The SDK Exists

Nimi has multiple owner domains. Runtime owns execution, LocalAgent
Conversation, Memory, and Knowledge. Realm owns Character, World, social, and
semantic truth. Desktop owns native shell behavior. Application code needs a
stable way to use those domains without importing their private implementation.

The SDK is that boundary. It projects admitted owner-domain behavior into
developer-facing TypeScript APIs. It does not invent Runtime, Realm, or Desktop
truth.

## Reader Scenario: A First Integration

An App that needs Realm data and Runtime-backed generation should:

1. Reuse its generated host-bound client; do not construct a second client
   with an App ID or endpoint.
2. Save the capability intent it needs, such as `text.generate`, through
   `client.aiConfig` or the generated AI settings.
3. Run AI work through `client.ai`. For a first text generation, start with
   [First AI Call](/sdk/first-ai-call).
4. Read Realm Worlds and PersonaCharacters through the App client's Realm
   operations.
5. Handle typed errors by their reason code and keep the actual error visible.

That App does not import Runtime internals, Realm REST routes, or removed SDK
compatibility paths.

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`runtime/internal/grpcserver/interceptor_public_transport.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/grpcserver/interceptor_public_transport.go)
