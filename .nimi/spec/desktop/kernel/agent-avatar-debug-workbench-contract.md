# Agent Avatar Debug Workbench Contract

> Authority: Desktop Kernel

## Scope

This contract owns the Desktop debug workbench product views for Avatar
configuration and backend evidence. It displays typed Runtime, SDK, and Avatar
evidence; it does not own probe semantics, backend execution, or success
criteria.

## D-LLM-084 — Debug Workbench Authority Home

Desktop MAY expose debug workbench views for:

- package validation
- launch readiness
- backend load evidence
- capability profile evidence
- route support matrix
- generated motion probe results
- emotion/expression probe results
- speech/lipsync probe results
- window/hit-region evidence
- Runtime audit/replay links
- Avatar carrier diagnostics
- actionable remediation states

Fixed rules:

- every view consumes typed SDK/Runtime/Avatar projections
- no view may synthesize success without concrete evidence
- raw provider payloads, raw APML parser diagnostics, MCP/A2A messages, and
  Desktop app data are invalid workbench inputs
- Desktop MUST NOT call Avatar backend commands directly from the workbench

## D-LLM-085 — Probe Taxonomy And Remediation States

Workbench probe categories are pinned by
`tables/agent-avatar-debug-workbench-probes.yaml`.

Remediation states are pinned by
`tables/agent-avatar-debug-remediation-states.yaml`.

The workbench must render unsupported, unavailable, invalid, and blocked states
as terminal evidence states unless a typed Runtime/Avatar retry path is present.

After Desktop requests a Runtime avatar debug probe, the workbench may briefly
poll the Runtime snapshot for the same `probe_id`. If Avatar submits an accepted
evidence-backed result through Runtime, the workbench must prefer that result
over the provisional `avatar_debug_session_not_available` blocked result. If no
accepted Avatar result appears, the provisional blocked result remains visible.

## D-LLM-086 — Replay And Audit Links

Runtime owns replay and audit semantics. Desktop may display Runtime replay
links and redacted replay summaries, but it must not reconstruct replay from
local UI state or Avatar backend logs.

Fixed rules:

- replay links must be Runtime-owned ids or typed SDK refs
- copied diagnostics must preserve evidence ids and reason codes
- missing replay evidence must fail closed as `runtime_replay_missing`

## D-LLM-087 — No App Bus Or Backend Command Bypass

The debug workbench does not admit a generic app-to-app bus.

Desktop MUST NOT:

- send backend command strings to Avatar
- expand wildcard event-bus semantics for Avatar configuration/debug
- route probe requests through raw Tauri `invoke` commands that bypass SDK and
  Runtime where Runtime semantics are required
- display raw quarantined provider output as user-facing success

## Traceability

- `.nimi/spec/runtime/kernel/avatar-debug-projection-contract.md`
- `.nimi/spec/avatar/kernel/avatar-debug-session-contract.md`
- `.nimi/spec/sdks/kernel/runtime-avatar-control-client-contract.md`
- `.nimi/spec/desktop/kernel/agent-delegation-control-surface-contract.md`
