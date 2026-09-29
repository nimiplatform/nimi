# Nimi Examples

The SDK examples are App code for a Nimi App. Each module takes the App's
host-bound `NimiLocalAppClient`: in a project created with
`@nimiplatform/app-tools`, pass `getNimiLocalAppClient()` from
`src/shell/auth/local-app-client.ts`.

They run inside the App's Desktop-supervised Host (`pnpm dev` in the App
project), not as standalone Node scripts. Runtime accepts App operations only
from a verified Host session; a direct gRPC client with an App ID is rejected
for AI execution, App AIConfig and App storage.

## SDK Examples

| File | Shows |
| --- | --- |
| `sdk/01-first-call.ts` | One text answer with `client.ai.text.generateCandidate` |
| `sdk/02-streaming.ts` | A streamed text turn with `client.ai.text.streamTurn`, including stop |
| `sdk/03-ai-config.ts` | Saving a Local `text.generate` intent without dropping the App's other capabilities |
| `sdk/04-vercel-ai-sdk.ts` | Vercel AI SDK 6 through `createNimiLocalAppVercelLanguageModel` |
| `sdk/05-scenario-job.ts` | An asynchronous `text-annotate` Job and its typed result |
| `sdk/advanced/app-access.ts` | Session posture from `client.auth.status()` and typed failure details |

Each call needs the App's matching App Access declaration (for example
`runtime.consume`) and a saved capability intent (for example `text.generate`).
The request carries content only; Runtime selects the Local or Cloud
implementation from the App's AIConfig when the call runs.

The Vercel example uses the separate `@nimiplatform/sdk-adapter-vercel-ai`
package. Install a release whose `@nimiplatform/sdk` peer range covers the SDK
version your App uses.

## Runtime CLI

`runtime/cli-quickstart.sh` checks a local Runtime with the `nimi` CLI
(`doctor`, `version`, `health --json`, `status`). It does not call AI
capabilities.

## App Scaffolds

Generate a fresh App with the `@nimiplatform/app-tools` CLI; this package does
not keep a hand-maintained scaffold copy.

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app create --dir my-nimi-app --profile standalone
```

## Compile Gate

```bash
pnpm --filter @nimiplatform/examples run check
```

The gate type-checks these modules against the SDK and adapter sources in
this repository. CI runs it when the SDK, the adapter, or these examples
change.
