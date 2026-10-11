# Nimi Examples

This directory provides developer examples demonstrating how to use the Nimi TypeScript SDK (`@nimiplatform/sdk`) and ecosystem tools to build personal AI applications.

## How SDK Examples Work

In a Nimi App, your application interacts with the local Runtime through a host-bound client (`NimiLocalAppClient`). For projects generated with `@nimiplatform/app-tools`, you can obtain this client via `getNimiLocalAppClient()` from `src/shell/auth/local-app-client.ts`.

SDK calls execute in the context of the App's supervised desktop session (`pnpm dev` in your app workspace), where the local Runtime enforces permissions and routes requests to the configured local model or cloud connector.

## SDK Example Catalog

| File | Feature Demonstrated | Description |
| --- | --- | --- |
| `sdk/01-first-call.ts` | Basic Text Generation | Simple prompt-response flow using `client.ai.text.generateCandidate` |
| `sdk/02-streaming.ts` | Streamed Text & Cancellation | Real-time response streaming with `client.ai.text.streamTurn`, including graceful cancellation handling |
| `sdk/03-ai-config.ts` | Capability Configuration | Persisting local AI capability intents without modifying unrelated app settings |
| `sdk/04-vercel-ai-sdk.ts` | Vercel AI SDK Integration | Using `@nimiplatform/sdk-adapter-vercel-ai` with standard Vercel AI SDK (v6) language models |
| `sdk/05-scenario-job.ts` | Asynchronous Scenario Jobs | Submitting an async job (e.g. `text-annotate`), observing status, and polling for results |
| `sdk/06-errors.ts` | Typed Error Handling | Inspecting and narrowing structured runtime errors using `isNimiError` |
| `sdk/07-voice-create.ts` | Voice Generation Job | Creating custom voice profiles from descriptive prompts via async job submission |
| `sdk/advanced/app-access.ts` | Session & Authorization Status | Inspecting current session posture and access state via `client.auth.status()` |

## Key Concepts & Best Practices

- **Declarative Access & Routing**: Requests only need to supply prompt content and parameters. The Nimi Runtime automatically routes the request according to the user's configured model or connector and active app permissions.
- **Graceful Stream Interruption**: When streaming responses (`sdk/02-streaming.ts`), applications should handle user cancellations cleanly and preserve error metadata when connections drop.
- **Vercel AI SDK Support**: The `@nimiplatform/sdk-adapter-vercel-ai` package allows developers to plug Nimi's local and cloud models directly into existing Vercel AI SDK workflows.

## Runtime CLI Quickstart

The `runtime/cli-quickstart.sh` script demonstrates useful diagnostic commands using the `nimi` CLI (`doctor`, `version`, `health --json`, and `status`).

## Creating a New App

To create a new app using the Nimi App Tools scaffold:

```bash
pnpm dlx --package=file:./nimi-packages/nimiplatform-app-tools-0.11.4.tgz nimi-app create --dir my-nimi-app --profile standalone
```

## Running Checks

Type-check and test the examples against the current workspace packages:

```bash
# Type-check all examples
pnpm --filter @nimiplatform/examples run check

# Run streaming and error regression tests
pnpm --filter @nimiplatform/examples test
```
