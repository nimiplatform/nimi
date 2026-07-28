# Error Ownership

Reference table mapping each layer of the Nimi stack to its error
contract, rule prefix, and authoritative source.

## Per-Layer Ownership

| Layer | Owner contract | Rule prefix | What it owns |
| --- | --- | --- | --- |
| Platform protocol | `.nimi/spec/platform/core-protocol.authority.yaml` | `P-PROTO-*` | Cross-world protocol error codes, action hints, audit event taxonomy |
| Runtime | `.nimi/spec/runtime/rpc-foundations.authority.yaml` | `K-ERR-*` | Reason codes, error classification, retry vs contract-failure distinction |
| Runtime streaming | `.nimi/spec/runtime/rpc-foundations.authority.yaml` | `K-STREAM-*` | Terminal frames, stream-level failure semantics |
| SDK | `.nimi/spec/sdks/client-core.authority.yaml` | `S-ERROR-*` | App-facing error projection, typed error shapes |
| Desktop | `.nimi/spec/desktop/shell-ui.authority.yaml` | `rule.nimi.desktop.shell-ui.*` | UI error boundary, retry policy, user-facing error rendering |

## Translation Tables

The Platform-to-Runtime mapping is the canonical translation point
between protocol-level errors and runtime reason codes:
`config/platform-error-code-mapping.yaml`.

Per-layer enumerations live in their own tables:

| Table | Layer |
| --- | --- |
| `platform/kernel/tables/protocol-error-codes.yaml` | Platform |
| `runtime/kernel/tables/reason-codes.yaml` | Runtime |
| `runtime/kernel/tables/error-mapping-matrix.yaml` | Runtime cross-layer |
| `config/sdks-error-codes.yaml` | SDK |
| `canonical/desktop/shell-runtime.authority.yaml` | Desktop |

## Distinguishing Transport Recovery From Contract Failure

| Failure class | Recoverable by | Authority |
| --- | --- | --- |
| Transport error (network, timeout, transient 5xx) | Retry, auth refresh | Transport / SDK transport contract |
| Auth refresh required | Auth refresh, token rotation | Runtime auth + SDK transport |
| Contract failure (typed shape, MIME, schema, missing field) | Not recoverable by retry; fails closed | Owner contract |
| Streaming terminal failure | Cannot rescue mid-stream; emit terminal failure frame | Runtime streaming |

Retry and auth refresh are transport mechanisms only. They must never
silently rescue a decode, content-type, schema, or contract failure.

## Cross-Layer Error Walk

A single failure typically crosses multiple layers. A worked example:
a streaming generation request whose upstream provider fails mid-response
lands as:

| Layer | Action |
| --- | --- |
| Provider | Returns transient error frame |
| Runtime provider-health | Classifies under `K-ERR-*` family |
| Runtime streaming | Decides recover-vs-terminate; if terminate, emits typed terminal failure frame |
| Runtime audit | Records failure with trace lineage |
| SDK error projection | Projects typed app-facing error per `S-ERROR-*` |
| Desktop UI | Surfaces under `D-*` error boundary |
| User | Sees governed failure, never a fabricated success |

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`config/platform-protocol-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-protocol-error-codes.yaml)
- [`config/platform-error-code-mapping.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-error-code-mapping.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`config/runtime-reason-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-reason-codes.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`config/sdks-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/sdks-error-codes.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
- [`.nimi/spec/desktop/shell-runtime.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-runtime.authority.yaml)
