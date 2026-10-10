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
| `sdk/05-scenario-job.ts` | Submit once, observe an asynchronous `text-annotate` Job with Get, and resume by Job ID |
| `sdk/06-errors.ts` | Narrow unknown failures with `isNimiError` and retain typed details |
| `sdk/07-voice-create.ts` | Submit one `voice-create` Job from a text description using a saved submission identity |
| `sdk/advanced/app-access.ts` | Session posture from `client.auth.status()` and typed failure details |

Each call needs the App's matching App Access declaration (for example
`runtime.consume`) and a saved capability intent (for example `text.generate`).
The request carries content only; Runtime captures the machine-selected Local Loadout or the exact committed
Cloud Connector and target when the Job is submitted.

The streaming example preserves `traceId` and the Runtime interruption's
`resubmitDisposition`. An uncertain outcome does not authorize resubmission.
When cleanup also fails, `AggregateError.cause` retains the primary failure and
`errors` retains both failures; typed primary metadata remains on the combined
error. Closing the stream once does not prove an external operation rolled back.

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
pnpm dlx --package=file:./nimi-packages/nimiplatform-app-tools-0.11.4.tgz nimi-app create --dir my-nimi-app --profile standalone
```

## Compile Gate

```bash
pnpm --filter @nimiplatform/examples run check
```

The gate type-checks these modules against the SDK and adapter sources in
this repository. CI runs it when the SDK, the adapter, or these examples
change.

`pnpm --filter @nimiplatform/examples test` also runs the streaming example's
cancellation and terminal-result regressions. These isolated consumer tests
do not establish a live Host or model execution.
