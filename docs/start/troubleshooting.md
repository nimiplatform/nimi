<!-- nimi-docs: {"authority":["rule.nimi.runtime.remote-access.source-admission","rule.nimi.runtime.remote-access.connection-lifetime","rule.nimi.runtime.service-operations.r086"],"sources":["runtime/cmd/nimi/runtime_health_commands.go","scripts/dev-app.mjs","kit/core/src/app-session.ts"]} -->

# Troubleshooting Nimi App Integration

Running into issues while developing a Nimi App, invoking SDK methods, running Nimi Lab tests, or launching local Runtime? This guide covers the most common integration hurdles, explains their root causes, and walks through how to resolve them.

---

## 1. Verify Runtime Startup Mode

Choose the Runtime startup method that matches your environment:

### Source Code Development (Recommended)

Complete [Environment Setup](/start/install), then run `pnpm dev:desktop` from the Nimi root. The launcher checks and starts missing configured services and Runtime before opening Home. Inspect startup errors in the terminal and `.nimi/local/dev-services/`. For independent Runtime debugging, run `pnpm dev:runtime` in a separate terminal and use its foreground logs.

Check Home connection and sign-in, the target App's Nimi Access, and an actual model call after configuration separately. A running process does not establish App admission or model readiness.

### Windows Background Service
If you installed the official Nimi desktop installer and registered the Windows system service:
- Run `nimi status` to check service state.
- Run `nimi start` to start the background service.
- Run `nimi doctor` to verify system prerequisites.
- Run `nimi health --json` for a structured health summary.

`nimi health --json` reports only the fixed-service controller state, `service-running/stopped`. It does not establish RPC or AI readiness or inspect the source supervisor. Systems without that controller, including the current macOS path, return an unavailable error.

> [!NOTE] Startup Caveat
> `nimi serve` is reserved for background daemon execution and is rejected by design when run in a standard developer shell. During local development, use `pnpm dev:runtime` instead. For packaged builds, always use the supported launcher for your platform (package lifecycle support is currently limited to macOS arm64 and Windows x86_64).

---

## 2. Check Host-Bound Client Session

Native Desktop Apps communicate with Runtime through their scaffolded host-bound client:

```ts
import { getNimiLocalAppClient } from './shell/auth/local-app-client';
const client = getNimiLocalAppClient();
```

- **Avoid standalone gRPC construction**: Never call `createNimiClient({ appId, ... })` with manual gRPC addresses inside an App. The App renderer relies on the protected host session—a standalone client cannot acquire protected access for that App, and requests will fail according to the rejected operation.
- **Recover cleanly on session rotation**: When a user switches accounts or re-establishes a session, stop in-flight work and discard stale handles before reading fresh state and recreating subscriptions under the new session. Simply refreshing a UI list will not rebind active background work.

---

## 3. Resolving `AI_CONFIG_NOT_FOUND`

If your AI generation request fails with `AI_CONFIG_NOT_FOUND` or `ai-config-not-found`:

### Root Cause
Your app has not yet saved a capability routing intent (such as `text.generate`) in the local Runtime.

### Resolution
1. Open the app's **AI Settings** modal (or configure it via Nimi Home's App Settings).
2. Choose an execution strategy for the required capability:
   - **Local Model**: Select a ready local resource configured for this capability in Nimi.
   - **Cloud Model**: Select a configured provider connector (e.g. OpenAI, Anthropic) with a valid API key.
3. Save the configuration and retry your request.

> [!TIP] Capability Intent Architecture
> Nimi uses a "Capability Intent" pattern: applications declare *what* capability they need (e.g. text generation, embeddings), while Runtime resolves *which* model satisfies it based on user preference. Applications stay decoupled from specific providers, giving users full control over their keys and compute.

---

## 4. Nimi Lab Error States Reference

When running validation suites in Nimi Lab, standard error states indicate specific failure modes:

| Error State | Root Cause | Recommended Action |
| :--- | :--- | :--- |
| `runtime-unavailable` | Cannot connect to the local Runtime service. | Inspect Home connection and startup logs; use foreground logs for a separate source Runtime, and host/direct-connection state for a remote client. |
| `principal-unauthorized` | The current session or caller is not authorized for this operation. | Check sign-in and this app’s Nimi Access status in Nimi Home, then verify the required access declarations in `nimi.app.yaml`; AI calls require `runtime.consume`. |
| `input-invalid` | Prompt or parameter schema is missing or invalid. | Check your request parameters and ensure `messages` follow the required schema. |
| `sdk-method-unavailable` | The installed SDK version lacks the invoked method. | Check the `@nimiplatform/sdk` version in `package.json` and upgrade to the matching release. |
| `runtime-call-failed` | An unhandled error occurred during model execution or network request. | Inspect Runtime terminal logs or the Desktop console for detailed stack traces. |

---

## 5. Project Health and Hygiene Checks

Inside your application repository, use the built-in scripts to verify project integrity:

```bash
# Validate project inputs and managed configuration
pnpm run check

# Run automated tests
pnpm run test
```

After updating dependencies or switching branches:

```bash
# Sync dependencies cleanly against the lockfile
pnpm install --frozen-lockfile

# Refresh managed configuration files (preserves your business logic)
pnpm run sync

# Verify project health
pnpm run check
```

---

## 6. Development Best Practices

1. **Stick to the host-bound client**: Reuse `getNimiLocalAppClient()` rather than creating multiple client instances.
2. **Program against capability intents**: Never hardcode model names or remote endpoints in your app logic.
3. **Provide actionable UI feedback**: Clearly distinguish between "waiting for inference", "service disconnected", and "access unavailable", and give users direct links to the relevant settings.

## Diagnose Remote Access by Layer

| Observed state | Next step |
| --- | --- |
| Signed out or expired login transaction | Sign in through this App's official browser entry; check exact source and callback |
| No primary Runtime | Start binding in PC Home and confirm on the official account website |
| Source pending, paused or revised | Inspect that source in primary PC Home; reuse valid confirmation and confirm/resume only as needed |
| Signed in but direct connection fails | Check host process, remote-access setting, matching Realm environment, trusted TLS and direct network reachability; no relay fallback exists |
| Connected but operation unavailable | Check actual package exports, carrier operation subset and App declaration; do not synthesize native identity |
| Missing AIConfig or model not ready | Save App intent, prepare model/cloud resources on the PC and submit a real call |
| Connection lost after Job submission | Query the saved Job/submission identifier and display the actual outcome; do not automatically resubmit |

Android development Scheme and distributed App Link have distinct package, signature, callback and environment requirements. The former applies only to explicitly admitted local development. See [Android setup](/start/connect-android-app).

## CDP Configuration Conflict for a Running Development App

If Home already launched the same development App, a launch requesting different CDP settings returns `local-development-cdp-configuration-conflict`. Stop that App normally in Home, then resume the same registration with its current selector and desired port. Do not create another registration to bypass the conflict or use Home's CDP target as the App acceptance target.

## Source Basis

- [`runtime/cmd/nimi/onboarding_helpers.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/cmd/nimi/onboarding_helpers.go)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`apps/lab/src/lab/lab-non-success.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-non-success.ts)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
