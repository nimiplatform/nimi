---
aside: false
---

# SDK Guide

The Nimi SDK is the official boundary for applications integrating Runtime, Realm, AI inference, Agent collaboration, feature modules, and shared type definitions. The core implementation lives under `sdks/typescript` and is published as `@nimiplatform/sdk`.

These host-bound examples target the SDK 0.21.0 source development combination with matching Kit/Runtime. Prepare its local archives or development bundle through [Environment Setup](/start/install). The Vercel example uses source adapter 0.5.0 and AI SDK 7; see [Adapters](/sdk/adapters) for the separate published-artifact pairing.

## Quick Start: Building a Nimi App

For standard Nimi Apps, development requires **a single host-bound client**. When Nimi Home launches an application in a supervised host, the host automatically injects a standard Shell bridge. The underlying Runtime resolves the signed-in user, application identity, and access boundaries directly from this protected session. Applications do not need to provide or manage App IDs, user credentials, tokens, or Runtime host endpoints.

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

Projects created with Nimi tooling already include this client factory in `src/shell/auth/local-app-client.ts`. Simply reuse it. Next, make your [First AI Call](/sdk/first-ai-call) through it.

## Common Entry Points & Recommended Use Cases

| Entry Point | Recommended Use Case |
| --- | --- |
| `client.ai.text.generateCandidate` | When an App needs standard single-turn text responses. See [First AI Call](/sdk/first-ai-call) for step-by-step guidance. |
| `client.aiConfig` | Read or persist an App's AI capability preferences and routing intents. See [AI Config](/sdk/ai-config-surface). |
| `createNimiLocalAppTextModel(client.ai)` (from `@nimiplatform/sdk/ai`) | When an App coordinates multi-step tool-calling loops, structured JSON output, or multi-modal vision inputs using the host-bound client. |
| `createNimiLocalAppVercelLanguageModel({ ai: client.ai })` (from `@nimiplatform/sdk-adapter-vercel-ai`) | When building on the Vercel AI SDK 7 ecosystem. Distributed as an independent adapter package; see [Adapters](/sdk/adapters). |
| `createNimiClient({ appId, runtime, realm })` | Dedicated to independent background daemons or standalone scripts managing their own Realm authentication outside the App surface. |

> [!WARNING]
> The last entry point, `createNimiClient({ appId, ... })`, returns a direct `NimiClient`, not an App client. Providing an App ID in its configuration does not grant supervised application privileges. Over standard loopback gRPC connections, Runtime strictly rejects App-scoped operations (such as AI execution, Job scheduling, App AIConfig, and Agent conversations) with `PROTECTED_ORIGIN_ROLE_MISMATCH`. Do not replace an App's host-bound client with it.

## Architecture Surfaces

<SdkSurfaces />

## Documentation Sections

- [Boundaries](/sdk/boundaries) — Import constraints and invocation rules apps must observe.
- [First AI Call](/sdk/first-ai-call) — Step-by-step guide to generating text through the host-bound client.
- [AI Config](/sdk/ai-config-surface) — Managing app-level model preferences and capability routing.
- [Runtime Client](/sdk/runtime-client) — Strongly-typed Runtime client for trusted external contexts.
- [Realm and Composition](/sdk/realm-world-client) — Consuming Realm canonical state and supported world composition features.
- [Adapters](/sdk/adapters) — External framework adapters (e.g. `@nimiplatform/sdk-adapter-vercel-ai`).
- [Shared Types](/sdk/types) — Portable public interfaces and normalized SDK error models.

## Public Export Subpaths

The TypeScript SDK adopts a single foundation package design; third-party framework adapters are distributed as distinct packages:

| Entry Point / Package | Responsibility & Role |
| --- | --- |
| `@nimiplatform/sdk` | Core factory `createNimiClient` and primary public exports |
| `@nimiplatform/sdk/app` | Host-bound App client types, standard shell contracts, and typed operations |
| `@nimiplatform/sdk/ai` | AI model interfaces and text model binding utilities |
| `@nimiplatform/sdk/runtime` | Strongly-typed Runtime client for supported environments; strictly respects authorization boundaries |
| `@nimiplatform/sdk/realm` | Standalone Realm client for independent scripts; Apps access Realm via their host-bound client |
| `@nimiplatform/sdk/types` | Portable public interfaces, schema types, and SDK error models |
| `@nimiplatform/sdk/contracts` | Open platform contract descriptors |
| `@nimiplatform/sdk/ai-runner` | Framework-agnostic AI runner facade |
| `@nimiplatform/sdk/testing` | Test harnesses and fixtures for SDK consumers |
| `@nimiplatform/sdk/features/*` | Demand-driven, consumer-oriented feature modules |

Legacy deprecated subpaths (such as `@nimiplatform/sdk/world`, `@nimiplatform/sdk/scope`, `@nimiplatform/sdk/ai-provider`, etc.) are completely retired and intentionally fail closed upon import.

## Purpose of the SDK

Nimi partitions responsibilities across distinct owner domains: Runtime coordinates local execution and Agent conversations; Cognition manages long-term memory; Realm maintains characters, virtual worlds, and social graphs; Desktop delivers native Shell integration.

Application code needs a reliable, idiomatic way to interact with these capabilities without coupling to private internal plumbing. The SDK establishes this formal contract boundary—projecting core platform protocols into ergonomic TypeScript APIs while safeguarding the platform's single source of truth.

## Typical Scenario: First-Time Integration

An application requiring Realm world data alongside local AI inference should:

1. **Reuse the host-bound client**: Use the preconfigured client from the project scaffold rather than instantiating a second client.
2. **Declare required capabilities**: Specify intents such as `text.generate` via `client.aiConfig` or the built-in configuration UI.
3. **Execute AI operations**: Run tasks via `client.ai`, starting with [First AI Call](/sdk/first-ai-call).
4. **Query Realm resources**: Safely access virtual worlds and personas through the host-bound client's Realm methods.
5. **Handle structured errors**: Inspect standard error reason codes for robust error handling while preserving diagnostics for troubleshooting.

Applications should never craft raw gRPC calls or bypass SDK contracts to invoke REST routes directly.

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`runtime/internal/grpcserver/interceptor_public_transport.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/grpcserver/interceptor_public_transport.go)
