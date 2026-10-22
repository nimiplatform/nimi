# AI content checks in Runtime

Nimi runs content checks directly in the Runtime on the user's device. Every app that calls `text.generate` gets the same inspection for prompts, generated output, and complete tool-call arguments—whether the request runs on a local model or a cloud provider.

Suppose a research app reads a file containing a private key and includes it in the next prompt, or a tool returns a token that gets fed back into the conversation. If that content matches one of the rules below, Runtime rejects the request before it reaches the model. Model output is checked too. Apps keep their own workflows without each maintaining a separate scanner.

::: info Developer preview
Content checks are available in current Runtime source builds, and the companion shell notice and conversation context controls require matching source builds of Runtime, SDK, Kit/native, and Home. These companion controls are a developer preview; check the release notes for your version when using prebuilt downloads. Apps do not need new request fields, registration steps, or configuration to use content checks.
:::

## How local inspection works

Runtime already resolves caller identity, holds provider credentials, and dispatches model requests. Running deterministic format checks in the same place means protection does not depend on whether a model obeys safety instructions in a prompt.

Inspection runs entirely on the user's machine with no network dependency and no external scanning service. When an app uses a cloud route, requests that pass inspection are still sent to the selected model provider.

Responsibilities stay distinct across the stack:

| Responsibility | Owner |
| --- | --- |
| Inspect business text in model inputs, outputs, and complete tool arguments | Runtime AI |
| Verify identity, permissions, credential custody, and resource access | Existing Runtime resource services |
| Execute tools, manage multi-turn state, render output, and obtain business approval | Your App host |

Passing a content check does not grant permission, and model output such as `approved: true` never establishes authorization. Integration business results and Delegation approval policies work as before.

## What gets checked and when

Current inspection covers `text.generate` in `SYNC` and `STREAM` execution. Candidate generation and `RuntimeAgent` calls are included whenever they use that path. Other AI capabilities, raw image/audio/video bytes, opaque continuity payloads, and calls outside `text.generate` are not covered.

| Stage | Checked content | Result of a match |
| --- | --- | --- |
| Model input | Normalized business text and JSON string values: system text, selected history and summaries, tool descriptions and schemas, tool results, and visible media-reference strings | Refused before model dispatch, media materialization, request-body capture, or new Job creation |
| Streaming output | Generated text and visible reasoning summaries, checked incrementally | Stops undelivered output and reports failure through the existing stream and Job path |
| Tool call | Complete arguments after decoding JSON escapes into actual values | Refused before forwarding the tool call to the App |
| Final result | Naturally complete text, visible summaries, and tool arguments | Refused before flushing final buffered output, completing normally, or storing a successful result |

Normal output keeps its existing chunking and buffering behavior. Inspection adds no timers, full-step buffering, or new output-length limits. Because a transport chunk boundary is not always a value boundary, Runtime can confirm some matches only when a delimiter or the end of a logical item arrives. Normal text continues to stream in the meantime.

In streaming mode, text already delivered before a match is confirmed cannot be recalled. Content checks help catch accidental credential exposure, but they do not guarantee zero leakage, act as an operating-system sandbox, or prevent all prompt injection, malicious model behavior, or data exfiltration.

## Current rules

The initial rules target specific, well-defined credential formats rather than blocking every sensitive word or high-entropy string.

| Rule | Match condition | Inspection mode |
| --- | --- | --- |
| `pem-private-key` | Complete, unencrypted PEM private keys that parse as PKCS8 (`PRIVATE KEY`), PKCS1 (`RSA PRIVATE KEY`), or SEC1 (`EC PRIVATE KEY`) | Complete values only |
| `github-classic-pat` | `ghp_` followed by exactly 36 ASCII letters or digits, with identifier boundaries on both sides | Complete values and incremental text |

For `github-classic-pat`, ASCII letters, digits, underscores (`_`), and non-ASCII bytes continue an identifier, so a match only triggers when the token stands on its own. Matching is purely structural—Runtime does not verify whether a credential was actually issued or remains active.

Other token formats, encrypted or OpenSSH private keys, and arbitrary encodings are not covered. Placeholders and ordinary technical text—such as `token: string`, `password: <redacted>`, empty values, hashes, standalone PEM headers, public keys, certificates, generic `Bearer` wording, sensitive field names, high-entropy strings, or prompt-injection phrases—do not trigger refusal on their own.

Local and cloud routes apply the same rules. A local request containing a private key in one of the covered formats is refused even for legitimate analysis. You can supply a redacted copy through your App's existing input controls; Runtime never silently rewrites your input.

## Handle a refusal in your App

When Runtime blocks content, it returns gRPC `FailedPrecondition` with reason `AI_CONTENT_FILTER_BLOCKED` (and exposes `ai-content-filter-blocked` on the protected App carrier). Branch on the typed error or event from your SDK rather than parsing user-facing error messages.

- **Input refusal:** The call fails before Runtime creates a Job or opens an output stream. Handle it as a call error; there is no stream `failed` event or successful result.
- **Output refusal:** An active stream reports failure through the existing `failed` path (and records Job failure) when the connection can still deliver it. Treat the entire model turn as failed, and **do not execute any tool calls** received earlier in that failed batch.
- **User guidance:** Tell the user that content filtering blocked the request or response, and ask them to review and redact the input or selected context before submitting again. Do not automatically retry, replay tools, or switch models, providers, or local/cloud routes.

A clear user-facing message is:

> This request or response did not pass the content check. Review the input and selected context, then remove or redact restricted content before submitting again.

### Shell notices and diagnostics

Cancellation, timeouts, permission errors, Runtime shutdown, and transport failures keep their own error codes and priority. When a content check blocks a call, the diagnostics available in the shell include only the failure reason and available fixed rule and stage values—never the matched secret. A format match only indicates that text matched a credential pattern; it does not prove that a key is active, that the model behaved maliciously, or that data leaked.

Keep two execution details in mind when presenting results:

- **Usage and billing:** Known usage may remain in the existing Job record, and missing usage data on a failed call does not mean the provider call was free.
- **Multi-turn boundaries:** If a `RuntimeAgent` operation is refused during a later model round, earlier turns or tool steps may have already run—do not tell the user that the entire operation stayed on the device.

In matching source builds of Home and the standard Kit Shell, the shell shows a single non-modal notice when a check blocks a request while preserving the App's original failure result. Users can immediately edit their draft or continue other tasks without submitting a report or toggling checks off.

## History and conversation recovery

Runtime never globally rewrites or scrubs stored App history, and a diagnostic event does not mean earlier records were cleaned. Old turns remain readable, but any history or summary included in a new request is checked again. If matched material stays in the selected context, even a harmless follow-up question will be refused.

Apps that manage their own context can let users edit or trim history through their existing input and context controls.

### Recovering a `RuntimeAgent` (`LocalAgent`) conversation

Each `LocalAgent` has a single persistent conversation identified by an anchor, which allows users to continue the same thread across different Apps. Simply reopening a conversation reuses that anchor and does not clear prior turns.

In matching source builds of Runtime, SDK, Kit/native, and Home, **Agent Center → State & memory** provides a conversation context control so users can adjust future history references while keeping their thread:

- **What it changes:** After reviewing the scope, the user can choose a new starting point for future history references and optionally omit supplemental Memory and retrieval in that conversation.
- **Cross-App continuity:** Earlier messages stay readable in the thread, and new turns continue on the same anchor. Because the Agent has a single persistent conversation, this selection applies to subsequent turns with that Agent across every App surface and persists across reopens and restarts until the user changes it again. Restoring the full history range brings earlier turns back into context—and back into content checks, which can trigger refusal again if restricted text is still present.
- **What remains untouched:** Changing context selection does not delete the conversation or stored Memory, turn Memory off, or send the user's current draft. It preserves required character and App instructions and permissions (if required instructions contain restricted text, their source owner must update them). It also does not cancel already accepted autonomous life activities or control how life planning performs its own Memory retrieval.
- **Access and state requirements:** Updating conversation context requires existing `agent.configure` access and is rejected if the Agent is busy or the state revision is stale. A chat-only App can pass the known conversation anchor to Home via `open-agent-center`, where Home resolves the target Agent under its own management permissions.

Memory keeps its existing validation rules when saving or editing entries. If a proposed correction is rejected, the stored memory stays unchanged and the draft remains editable. Omitting supplemental Memory from conversation context does not disable Memory validation or exempt any turn from content checks.

## Continue building

- [Make your first AI call](/sdk/first-ai-call)
- [Streaming behavior](/runtime/streaming)
- [Transport and errors](/sdk/transport-and-error)

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`runtime/internal/riskcontrol/detector.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/riskcontrol/detector.go)
- [`runtime/internal/services/ai/text_risk_checks.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/services/ai/text_risk_checks.go)
