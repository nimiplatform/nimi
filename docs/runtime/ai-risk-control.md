# Centralized AI risk control

Nimi puts content checks in the Runtime on the user's device. Apps that use its text-generation path share the same checks for model inputs, generated output, and complete tool-call arguments, across both local and cloud routes.

For example, a research app may retrieve a document containing a private key and include it in its next model request. Runtime can reject that request before model dispatch. The same rule applies when a writing app includes the material in a prompt or when a tool result becomes the next model input. Each app keeps its own workflow; the shared execution layer supplies the content check.

::: info Developer preview
This feature is implemented in current Runtime source builds. Use a Runtime build that includes it; availability in a published download follows that release's notes. No new App request fields, registration steps, or mandatory risk-control configuration are required.
:::

## A common enforcement point

Runtime already resolves the authorized caller, keeps provider credentials in its custody, and executes the selected model request. Content inspection adds another check at that shared boundary. Rules can evolve there without asking every app to build a separate scanner or replace its AI host.

The covered formats are checked by deterministic code, independently of whether the model follows a safety instruction in its prompt.

“Centralized” describes where enforcement lives: in the local Runtime shared by its consumers. Detection has no network dependency and does not send content to a separate security service. Choosing a cloud model still sends admitted request data to that provider.

These responsibilities remain distinct:

| Responsibility | Owner |
| --- | --- |
| Check model business input, output, and complete tool arguments | Runtime AI |
| Resolve identity, permissions, credential custody, and resource access | The existing Runtime resource owners |
| Run business tools, manage later model turns, display results, and obtain business approval | The App's existing host |

A clean scan does not grant permission. Model text such as `approved: true` never establishes authorization.

## Where checks run

Current inspection covers `text.generate` in SYNC and STREAM execution. Candidate generation and RuntimeAgent calls inherit it when they use that same Scenario path.

| Boundary | Checked content | Result of a match |
| --- | --- | --- |
| Model input | Normalized business text and JSON string values: system text, selected history and summaries, tool descriptions and schemas, tool results, and visible media-reference strings | Refuse before model dispatch, media materialization, and capture of a new request body or Job |
| Streaming output | Text and visible reasoning summaries, incrementally | Stop undelivered output and report failure through the existing stream |
| Tool call | Complete arguments, with JSON escapes decoded into actual values | Refuse before forwarding the call to the App |
| Final result | Naturally available complete text, visible summaries, and tool arguments | Refuse before final buffered output, normal completion, or successful result storage |

Normal content follows the original chunking and buffering behavior. Inspection adds no timer, whole-step delivery wait, or new output limit. A chunk boundary is not a value boundary: a possible match may need a delimiter or logical item completion before it can be confirmed.

## Current rules

The initial rules target a small set of recognizable credential formats, rather than every occurrence of a sensitive word.

| Rule | Match | Inspection mode |
| --- | --- | --- |
| `pem-private-key` | Complete, unencrypted PEM private keys that parse as PKCS8 (`PRIVATE KEY`), PKCS1 (`RSA PRIVATE KEY`), or SEC1 (`EC PRIVATE KEY`) | Complete values only |
| `github-classic-pat` | `ghp_` followed by exactly 36 ASCII letters or digits, with identifier boundaries on both sides | Complete values and incremental text |

For the token rule, ASCII letters, digits, underscore, and non-ASCII bytes continue an identifier. A format match does not verify that a credential was issued or is usable. Other token formats, encrypted or OpenSSH private-key formats, and arbitrary encodings are not covered by these rules.

`token: string`, `password: <redacted>`, empty values, ordinary hashes, PEM headers alone, public keys, and certificates do not independently cause refusal. Neither do generic Bearer wording, sensitive property names, high entropy, or prompt-injection phrases.

## Handle a refusal in your App

New Runtime content decisions use gRPC `FailedPrecondition` with `AI_CONTENT_FILTER_BLOCKED`. The protected App carrier also exposes the corresponding `ai-content-filter-blocked` token. Use the typed error or event provided by your SDK surface; do not classify the failure by parsing user-facing prose.

- **Input refusal:** the original call fails before a Job or output stream is established. There is no fabricated stream `failed` event or successful result.
- **Output refusal:** an established stream reports `failed` when the connection can still deliver it. Preserve the reason and treat the model step as failed. Do not execute previously received tool calls from that failed batch.
- **User guidance:** explain that content filtering blocked the request or response. Ask the user to review and redact the input or selected context before explicitly submitting a revised request. Do not automatically retry, replay tools, or switch models, providers, or routes.

An appropriate message is: “Content filtering blocked this request or response. Review the input and selected context before submitting a revised request.”

Existing cancellation, timeout, permission, shutdown, and transport failures keep their own meaning. New Runtime risk diagnostics record rule and stage information without the matched secret. Existing App histories are not globally rewritten or redacted. Known usage may remain in the existing Job record; missing usage does not mean a failed call was free.

## Streaming and context limits

Streaming is preserved, so content can already be visible before a match is confirmed. Runtime stops the remaining delivery; it cannot recall text already shown. This is not a zero-leakage guarantee.

Local requests use the same rules. Legitimate analysis of an actual private key can therefore be refused even on a local model. Supply an explicitly redacted copy through your existing input controls; Runtime does not silently rewrite the original material.

Old records remain readable. If selected history or a summary contains matching material, a harmless new question can still be refused. Apps may use their existing explicit context-editing or new-conversation controls. Reopening a RuntimeAgent conversation reuses its anchor rather than resetting history; an affected conversation can remain unable to infer while the material is selected. There is no automatic cleanup, history exemption, or new reset protocol.

Image, audio, video, opaque continuity, other AI capabilities, and calls outside this text-generation path are outside current inspection. Integration business results and Delegation approval policies retain their existing behavior. This feature is a shared model-boundary defense, not an operating-system sandbox or a guarantee against malicious models, prompt injection, or arbitrary data exfiltration.

## Continue building

- [Make your first AI call](/sdk/first-ai-call)
- [Streaming behavior](/runtime/streaming)
- [Transport and errors](/sdk/transport-and-error)

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`runtime/internal/riskcontrol/detector.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/riskcontrol/detector.go)
- [`runtime/internal/services/ai/text_risk_checks.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/services/ai/text_risk_checks.go)
