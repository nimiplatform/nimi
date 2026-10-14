# Making Your First AI Call

Welcome to building your first AI-native Nimi App! In this walkthrough, you will make a live text generation request in just a few lines of code.

Along the way, you will see Nimi's core design philosophy in action: **your application code never touches API keys, internal gRPC endpoints, or vendor-specific routing logic—it simply declares what it wants to achieve.**

---

## 1. Prerequisites

Before making your request, verify that:

1. **Your supervised dev environment is running**: Launch your app with `pnpm dev`. It runs inside an Electron window managed by Nimi Desktop with an injected security bridge (do not open raw renderer URLs directly in a browser).
2. **Declarations and session are ready**: Confirm that `nimi.app.yaml` declares `runtime.consume`. In Nimi Home, check Nimi Access for your development registration and verify that its session is ready—a running window alone does not establish access.
3. **AI capability intent is configured**: Open your app's AI settings and select a preferred model for `text.generate` (either a local model ready in Nimi or a configured cloud provider).

---

## 2. Write the Text Generation Logic

Projects scaffolded with App Tools already provide a host-bound client singleton. Create `src/first-ai-call.ts`:

```ts
import { getNimiLocalAppClient } from './shell/auth/local-app-client.js';

export async function generateText(prompt: string) {
  // Retrieve the host-bound client singleton
  const client = getNimiLocalAppClient();

  // Dispatch a single-turn text generation request
  const response = await client.ai.text.generateCandidate({
    messages: [
      { role: 'user', text: prompt }
    ],
  });

  return response.text;
}
```

### What Happens Under the Hood?

- **Zero Credential Exposure**: No API keys, secret tokens, or private endpoints appear in your frontend code.
- **Automatic Identity Resolution**: Runtime extracts your App identity directly from the protected host bridge and resolves your app's configured routing rules.
- **Portability by Default**: Whether your request is fulfilled by a local open-weight model on your GPU or a remote cloud provider, the application contract remains identical.

---

## 3. Connect to the UI

The default App Tools template uses React. Save the following component as `src/FirstAIExample.tsx` and render `<FirstAIExample />` on your product page inside the existing `WorkbenchRuntimeGate`, keeping the template's sign-in, Runtime readiness, and AI settings controls intact:

```tsx
import { useState } from 'react';
import { generateText } from './first-ai-call';

export function FirstAIExample() {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      setResult(await generateText(prompt));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Generation failed. Check your AI settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <label>
        Your prompt
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </label>
      <button disabled={busy || !prompt.trim()} onClick={generate}>
        {busy ? 'Generating…' : 'Generate'}
      </button>
      {error && <p role="alert">{error}</p>}
      {result && <pre style={{ whiteSpace: 'pre-wrap' }}>{result}</pre>}
    </section>
  );
}
```

---

## 4. Quick Diagnostics

When troubleshooting, distinguish between a request that is still in flight and one that has failed, and preserve the full error details for inspection. Note that `principal-unauthorized` and `runtime-unavailable` below are Lab presentation categories rather than universal raw SDK error codes:

| Issue | Root Cause | Resolution |
| :--- | :--- | :--- |
| `AI_CONFIG_NOT_FOUND` | No model preference has been saved for this capability | Open App Settings, choose a local or cloud model for `text.generate`, and click Save. |
| `principal-unauthorized` | The current session or caller is not authorized for this operation. | Check sign-in and this app’s Nimi Access status in Nimi Home, then verify the required access declarations in `nimi.app.yaml`; AI calls require `runtime.consume`. |
| `runtime-unavailable` | Local Runtime service is not running | Ensure `pnpm dev:runtime` is active in your terminal. |
| Timeout / Unresponsive | Insufficient local VRAM or remote network latency | Check Runtime terminal output, switch to a smaller model, or verify internet connectivity. |

---

## Next Steps

- [Explore SDK Capabilities](/sdk/) — Discover streaming, Agent orchestration, and Realm resources
- [AI Capability Intent Architecture](/sdk/ai-config-surface) — Deep dive into multi-model dispatch and user sovereignty
- [Build Rich UI with Nimi Kit](/platform/kit/use-kit-in-app) — Integrate ready-to-use cross-platform components

## Source Basis

- [`app-tools/templates/default-starter/src/shell/auth/local-app-client.ts`](https://github.com/nimiplatform/nimi/blob/main/app-tools/templates/default-starter/src/shell/auth/local-app-client.ts)
- [`sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
