# Nimi Code Examples

Welcome to the Nimi developer examples catalog! Here you'll find host-bound code recipes and tested example functions illustrating how to build with the Nimi TypeScript SDK (`@nimiplatform/sdk`) and integrate local-first AI capabilities into your applications.

---

## Architecture & How Examples Run

In a real Nimi App, your frontend interacts with the local Runtime through a **host-bound client** (`NimiLocalAppClient`), obtained via `getNimiLocalAppClient()`:

```ts
import { getNimiLocalAppClient } from './shell/auth/local-app-client';

const client = getNimiLocalAppClient();
```

When you launch your app with `pnpm dev`, it executes inside Desktop's supervised environment. The local Runtime authenticates your application session and routes AI requests to the user's preferred local model or configured cloud connector.

---

## SDK Example Catalog

| File | Scenario | What It Shows |
| :--- | :--- | :--- |
| [`sdk/01-first-call.ts`](sdk/01-first-call.ts) | Basic Text Generation | Single-turn prompt-and-response using `client.ai.text.generateCandidate` |
| [`sdk/02-streaming.ts`](sdk/02-streaming.ts) | Streaming & Cancellation | Token-by-token streaming with `streamTurn`, plus graceful abort handling |
| [`sdk/03-ai-config.ts`](sdk/03-ai-config.ts) | AI Capability Intents | Persisting app-specific model preferences without touching system defaults |
| [`sdk/04-vercel-ai-sdk.ts`](sdk/04-vercel-ai-sdk.ts) | Vercel AI SDK Integration | Using `@nimiplatform/sdk-adapter-vercel-ai` to power standard Vercel AI models |
| [`sdk/05-scenario-job.ts`](sdk/05-scenario-job.ts) | Async Scenario Jobs | Submitting background tasks (`text-annotate`), observing status, and polling results |
| [`sdk/06-errors.ts`](sdk/06-errors.ts) | Structured Error Handling | Catching and inspecting typed errors using `isNimiError` and reason codes |
| [`sdk/07-voice-create.ts`](sdk/07-voice-create.ts) | Voice Cloning & Persona | Creating a voice asset from a text description via async job submission |
| [`sdk/advanced/app-access.ts`](sdk/advanced/app-access.ts) | Session Posture | Inspecting authorization and active session boundaries via `client.auth.status()` |

---

## Creating a Fresh App

To scaffold a complete standalone application containing these primitives and UI wiring:

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app create \
  --dir my-nimi-app \
  --profile standalone \
  --features studio-create \
  --app-id com.example.myapp \
  --title "My Nimi App"
```

---

## Verifying Examples

You can run automated type checks and regression tests against all example code:

```bash
# Run TypeScript typechecking across all example files
pnpm --filter @nimiplatform/examples run check

# Run automated tests
pnpm --filter @nimiplatform/examples test
```
