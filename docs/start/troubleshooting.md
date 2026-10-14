# Troubleshooting Nimi App Integration

Running into issues while developing a Nimi App, invoking SDK methods, running Nimi Lab tests, or launching local Runtime? This guide covers the most common integration hurdles, explains their root causes, and walks through how to resolve them.

---

## 1. Verify Runtime Startup Mode

Choose the Runtime startup method that matches your environment:

### Source Code Development (Recommended)
Open a dedicated terminal at the root of the Nimi repository:
```bash
pnpm dev:runtime
```
In a second terminal, run `pnpm dev:desktop` and sign in to Nimi Home. This launches the standard two-process developer supervisor workflow.

### Windows Background Service
If you installed the official Nimi desktop installer and registered the Windows system service:
- Run `nimi status` to check service state.
- Run `nimi start` to start the background service.
- Run `nimi doctor` to verify system prerequisites.
- Run `nimi health --json` for a structured health summary.

> [!NOTE] Startup Caveat
> `nimi serve` is reserved for background daemon execution and is rejected by design when run in a standard developer shell. During local development, use `pnpm dev:runtime` instead. For packaged builds, always use the supported launcher for your platform (package lifecycle support is currently limited to macOS arm64 and Windows x86_64).

---

## 2. Check Host-Bound Client Session

Nimi Apps must communicate with Runtime through the scaffolded host-bound client:

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
| `runtime-unavailable` | Cannot connect to the local Runtime service. | Ensure `pnpm dev:runtime` is running and local port connectivity is normal. |
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

## Source Basis

- [`runtime/cmd/nimi/onboarding_helpers.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/cmd/nimi/onboarding_helpers.go)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`apps/lab/src/lab/lab-non-success.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-non-success.ts)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
