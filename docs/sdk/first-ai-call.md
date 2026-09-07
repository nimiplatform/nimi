# First AI Call in a Nimi App

Use the App's host-bound SDK client to make one real text-generation request. Nimi Home establishes the App session; Runtime reads that App's saved AI configuration and chooses the implementation when execution starts.

This guide continues [Create a Nimi App](/start/create-an-app) with the public App Tools 0.2.7 starter. Keep the generated SDK/Kit binding. The App renderer does not need a gRPC endpoint, account ID, session token, or a caller-selected App identity.

## Before the Call

1. Start the project with `pnpm dev` in a compatible Nimi Home development environment. Use its supervised Electron window, not the renderer URL in a browser.
2. Declare `runtime.consume` in `nimi.app.yaml` and establish the App's required access through the host. Declaring access and obtaining it are separate results.
3. Configure `text.generate` for this App through its AI settings or Nimi Home's App settings. A local route uses the machine's current model selection; a cloud route needs the appropriate configured connector and target. Saving configuration does not prove that generation will succeed.

Use [development setup](/start/install) for prerequisites and [Use Kit in an App](/platform/kit/use-kit-in-app) for shared settings and host integration.

## Generate Text

The default starter already exports `getNimiLocalAppClient()` from `src/shell/auth/local-app-client.ts`. Reuse it. In an existing App with a different file layout, use that App's equivalent host-bound client.

```ts
// src/first-ai-call.ts in the default App Tools 0.2.7 starter
import { getNimiLocalAppClient } from './shell/auth/local-app-client.js';

export async function generateText(prompt: string) {
  const client = getNimiLocalAppClient();
  return await client.ai.text.generateCandidate({
    messages: [{ role: 'user', text: prompt }],
  });
}
```

Call `generateText()` from an App action and present the returned `text`. Show a loading state while the promise is pending; on rejection, show the actual error and an appropriate recovery action. Do not render a sample response as though it came from Runtime.

The request carries conversation content. It does not select a model, connector, execution endpoint, fallback, or machine binding. Runtime obtains the App identity from the protected host session and applies its current Local or Cloud intent. Provider credentials remain in Runtime-owned configuration.

## Diagnose the First Failure

| Failure | Next step |
| --- | --- |
| No bound App session or an access error | Return to the supervised App launch and its host access flow. Do not replace the binding with a direct Node/gRPC client or supply your own identity. |
| `AI_CONFIG_NOT_FOUND` or missing `text.generate` intent | Save the capability intent for this App in its AI settings, then retry the actual call. |
| Local model or cloud configuration is unavailable | Inspect that App's current settings and the Runtime-selected model or connector state. Preserve the actual error; a configured route is not a successful execution. |
| Runtime disconnected | Restore the existing Nimi Home/Runtime development instance, reopen the supervised App if needed, and retry the same action. |
| Execution fails after dispatch | Inspect the typed error and its available reason/action fields. Do not synthesize a client-side fallback or switch providers silently. |

For setup debugging, the same client exposes `auth.status()` and `aiConfig.get()`. These are current state reads, not substitutes for an actual generation request. More setup errors are covered in [Troubleshooting](/start/troubleshooting).

## Confirm the Result

Run the App repository's existing checks, then make one request in its actual supervised window using its own client. Confirm pending, success, and any observed failure separately. A returned greeting can verify the first capability call; it does not establish that the App's full product journey or public distribution is ready.

Do not copy Nimi's repository-wide SDK/Lab test commands into a third-party App as a prerequisite. Follow the scripts declared by that project.

## Source Basis

- [`app-tools/templates/default-starter/src/shell/auth/local-app-client.ts`](https://github.com/nimiplatform/nimi/blob/main/app-tools/templates/default-starter/src/shell/auth/local-app-client.ts)
- [`sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts)
- [`kit/shell/renderer/src/bridge/local-app.ts`](https://github.com/nimiplatform/nimi/blob/main/kit/shell/renderer/src/bridge/local-app.ts)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
