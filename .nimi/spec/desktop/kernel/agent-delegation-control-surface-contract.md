# Agent Delegation Control Surface Contract

> Authority: Desktop Kernel

## Scope

Desktop control-surface rules for Runtime-owned delegated capability gateway
configuration, approval UX, and diagnostics. Desktop owns only the product
surface. Runtime owns delegated provider profiles, approval decision semantics,
credential custody, firewall verdicts, audit/replay truth, and typed
`runtime.agent.*` projections.

## D-LLM-073 — Runtime-Owned Delegation Control Path

Desktop delegated capability surfaces MUST call Runtime through the SDK typed
`RuntimeAgentService` delegation methods:

- `ListDelegatedProviderProfiles`
- `UpsertDelegatedProviderProfile`
- `SetDelegatedProviderState`
- `ListDelegatedApprovalRequests`
- `SubmitDelegatedApprovalDecision`
- `ListDelegatedDiagnostics`
- `GetDelegatedReplayTrace`
- `GetDelegatedControlSurfaceSnapshot`
- `ExecuteDelegatedCapability` for Runtime-owned debug execution only

Fixed constraints:

- Desktop MUST NOT import MCP/A2A clients or protocol SDKs.
- Desktop MUST NOT write delegated provider state into local app truth.
- Desktop MUST NOT mutate approval policy, firewall verdict, audit state, or
  provider execution semantics outside Runtime.
- Desktop MUST NOT route delegated control through Realm REST, app-local IPC, or
  raw Tauri commands that bypass the Runtime SDK bridge.

## D-LLM-074 — Product Surface Placement

Desktop MAY expose delegated capability controls in agent chat settings, avatar
configuration, connector configuration, debug workbench, and approval UX panels.

Fixed constraints:

- All five placements consume the same Runtime snapshot and Runtime SDK methods.
- Agent chat settings MAY select an agent and conversation anchor but MUST NOT
  create delegated provider authority.
- Avatar configuration MAY inspect delegated capability status for debugging but
  MUST NOT feed Avatar raw delegated output or raw `apml.*`/MCP/A2A events.
- Connector configuration MAY reference Runtime credential custody identifiers
  such as `connector://`, `key-source://`, or `grant://`; it MUST NOT expose raw
  credential material to delegated provider profiles.
- Debug workbench diagnostics MUST show Runtime decision/audit evidence; it MUST
  NOT synthesize success or hide firewall rejection.
- Avatar-specific configuration and debug workbench truth lives in
  `agent-avatar-configuration-contract.md` and
  `agent-avatar-debug-workbench-contract.md`. This rule remains the
  delegated-capability placement cross-reference and does not own backend
  capability profile refs, Runtime avatar probe semantics, or Avatar backend
  evidence.

## D-LLM-075 — Approval UX Boundary

Desktop approval UX is a user interaction surface for Runtime-owned pending
approval requests.

Fixed constraints:

- Desktop MUST render pending requests from `ListDelegatedApprovalRequests` or
  `GetDelegatedControlSurfaceSnapshot`.
- Approval and rejection MUST call `SubmitDelegatedApprovalDecision`.
- Desktop MUST NOT execute delegated actions directly after user approval.
- Desktop MUST NOT convert an approval decision into model context, projection,
  or action admission; Runtime remains the only admission owner.
- Non-pending approvals MUST be displayed as terminal state or omitted by filter;
  Desktop MUST NOT reopen them locally.

## D-LLM-076 — Provider Profile And Credential Boundary

Desktop provider profile configuration MUST remain a typed Runtime projection.

Fixed constraints:

- Provider profile writes MUST call `UpsertDelegatedProviderProfile`.
- Provider enable/disable MUST call `SetDelegatedProviderState`.
- Desktop MUST NOT store raw delegated provider credentials in component state
  beyond transient form input for Runtime credential references.
- `credential_ref` values MUST reference Runtime credential custody only.
- `transport_ref` values MUST identify Runtime-managed transport descriptors;
  Desktop MUST NOT spawn or supervise delegated provider transports directly.

## D-LLM-077 — Diagnostics And No-Bypass Gates

Desktop diagnostics MAY display Runtime delegated gateway/firewall/audit
evidence.

Fixed constraints:

- Diagnostics MUST come from `ListDelegatedDiagnostics`,
  `GetDelegatedReplayTrace`, or `GetDelegatedControlSurfaceSnapshot`.
- Desktop MUST preserve `gateway_evidence_id`, `firewall_input_id`,
  `firewall_verdict`, `runtime_decision`, and `reason_code` when displayed or
  copied.
- Replay views MUST render Runtime redacted replay stages only; they MUST NOT
  request, store, or infer raw provider output, hidden prompts, credential
  material, or protocol-native payloads.
- Desktop MUST NOT consume raw provider output, raw MCP result payloads, raw A2A
  task messages, or quarantine evidence as model/UI/action truth.
- Desktop and Avatar MUST continue to consume only typed Runtime projections for
  any user-visible delegated result.
