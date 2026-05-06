# Error Ownership

Reference table mapping each layer of the Nimi stack to its error
contract, rule prefix, and authoritative source.

## Per-Layer Ownership

| Layer | Owner contract | Rule prefix | What it owns |
| --- | --- | --- | --- |
| Platform protocol | `.nimi/spec/platform/kernel/protocol-contract.md` | `P-PROTO-*` | Cross-world protocol error codes, action hints, audit event taxonomy |
| Runtime | `.nimi/spec/runtime/kernel/error-model.md` | `K-ERR-*` | Reason codes, error classification, retry vs contract-failure distinction |
| Runtime streaming | `.nimi/spec/runtime/kernel/streaming-contract.md` | `K-STREAM-*` | Terminal frames, stream-level failure semantics |
| SDK | `.nimi/spec/sdk/kernel/error-projection.md` | `S-ERROR-*` | App-facing error projection, typed error shapes |
| Desktop | `.nimi/spec/desktop/kernel/error-boundary-contract.md` | `D-*` | UI error boundary, retry policy, user-facing error rendering |

## Translation Tables

The Platform-to-Runtime mapping is the canonical translation point
between protocol-level errors and runtime reason codes:
`.nimi/spec/platform/kernel/tables/error-code-mapping.yaml`.

Per-layer enumerations live in their own tables:

| Table | Layer |
| --- | --- |
| `platform/kernel/tables/protocol-error-codes.yaml` | Platform |
| `runtime/kernel/tables/reason-codes.yaml` | Runtime |
| `runtime/kernel/tables/error-mapping-matrix.yaml` | Runtime cross-layer |
| `sdk/kernel/tables/sdk-error-codes.yaml` | SDK |
| `desktop/kernel/tables/retry-status-codes.yaml` | Desktop |

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
| Runtime workflow | Workflow state moves to `FAILED` |
| Runtime audit | Records failure with trace lineage |
| SDK error projection | Projects typed app-facing error per `S-ERROR-*` |
| Desktop UI | Surfaces under `D-*` error boundary |
| User | Sees governed failure, never a fabricated success |

## Source Basis

- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/protocol-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-error-codes.yaml)
- [`.nimi/spec/platform/kernel/tables/error-code-mapping.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/error-code-mapping.yaml)
- [`.nimi/spec/runtime/kernel/error-model.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/error-model.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/audit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/audit-contract.md)
- [`.nimi/spec/runtime/kernel/tables/reason-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/reason-codes.yaml)
- [`.nimi/spec/runtime/kernel/tables/error-mapping-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/error-mapping-matrix.yaml)
- [`.nimi/spec/sdk/kernel/error-projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/error-projection.md)
- [`.nimi/spec/sdk/kernel/tables/sdk-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/sdk-error-codes.yaml)
- [`.nimi/spec/desktop/kernel/error-boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/error-boundary-contract.md)
- [`.nimi/spec/desktop/kernel/network-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/network-contract.md)
- [`.nimi/spec/desktop/kernel/tables/retry-status-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/retry-status-codes.yaml)
