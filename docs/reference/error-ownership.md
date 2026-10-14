# Error Ownership and Layered Fault Attribution

The Nimi architecture organizes errors through standardized code prefixes and mapping layers, attributing faults to specific subsystems while providing clear remediation paths.

## Error Prefixes Across Architectural Layers

| Layer | Governing Authority | Prefix | Scope & Responsibility |
| --- | --- | --- | --- |
| **Platform Protocol** | `.nimi/spec/platform/core-protocol.authority.yaml` | `P-PROTO-*` | Cross-world primitive violations, world gating, spacetime continuity |
| **Local Runtime** | `.nimi/spec/runtime/rpc-foundations.authority.yaml` | `K-ERR-*` | Inference timeouts, driver failures, VRAM exhaustion, invalid tokens |
| **Runtime Streaming** | `.nimi/spec/runtime/rpc-foundations.authority.yaml` | `K-STREAM-*` | Delta parsing errors, buffer overflows, premature stream termination |
| **SDK Client** | `.nimi/spec/sdks/client-core.authority.yaml` | `S-ERROR-*` | Application argument validation, transport disconnections, state drift |
| **Desktop Shell** | `.nimi/spec/desktop/shell-ui.authority.yaml` | `rule.nimi.desktop.shell-ui.*` | UI error boundary catches, retry policies, user notifications |

## Error Classifications and Remediation Strategies

| Classification | Manifestation | Recommended Remediation Strategy |
| --- | --- | --- |
| **Transient Transport Errors** | Network timeouts, socket resets, HTTP 502/503 | Retries follow operation idempotency contracts: safe read or idempotent calls may use exponential backoff; operations with unconfirmed external side effects require inspecting the original job/call status rather than blind resubmission |
| **Credential Expiry** | Expired tokens, session refreshes | Runtime refreshes credentials in the background; resubmission of pending requests must respect operation idempotency and unconfirmed side-effect boundaries |
| **Contract / Validation Errors** | Missing fields, malformed MIME types, schema drift | Fail closed; inspect structured reason code to fix caller arguments |
| **Streaming Interruption** | Network drop mid-generation, user stop action | Clear transient incomplete tokens while preserving committed turn history |

## End-to-End Error Propagation Flow

When an upstream model provider experiences a transient outage:

1. **Provider Failure**: Remote model API returns an HTTP 500 error.
2. **Runtime Classification**: Runtime captures the event, classifies it under reason code `AI_PROVIDER_INTERNAL` (governed by runtime rule `K-ERR-*`), and logs local audit traces with a Trace ID.
3. **SDK Normalization**: The SDK encapsulates the exception into a structured `NimiError` (with `reasonCode: 'AI_PROVIDER_INTERNAL'` and the actual `actionHint` returned for that operation).
4. **Desktop UI Rendering**: The UI catches the error at its component boundary, rendering a contextual prompt ("Model provider encountered an internal error; please try again later or switch provider") with actionable retry controls.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
