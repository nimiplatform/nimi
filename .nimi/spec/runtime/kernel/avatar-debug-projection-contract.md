# Avatar Debug Projection Contract

> Owner Domain: `K-AGCORE-*`
> Topic: `2026-05-01-desktop-avatar-configuration-debug-workbench`

## K-AGCORE-054 Avatar Debug Projection Authority Home

Runtime owns avatar debug probe request/result/replay semantics whenever the
probe is visible outside Avatar or participates in Desktop product diagnostics.

This contract extends the runtime-owned `runtime.agent.*` projection boundary.
It does not transfer APML wire ownership, Avatar backend execution, or Desktop
product layout ownership to Runtime.

## K-AGCORE-055 Avatar Probe Request Envelope

Avatar debug probe requests are Runtime-owned typed envelopes.

Required identity fields:

- `probe_id`
- `agent_id`
- `conversation_anchor_id`
- `probe_kind`
- `requested_at`
- `requested_by`

Optional trace fields:

- `turn_id`
- `stream_id`
- `avatar_instance_id`
- `runtime_replay_ref`

Fixed rules:

- request `probe_kind` values are pinned in
  `tables/avatar-debug-probe-events.yaml`
- Runtime must validate authorization before a request is projected
- probe requests must not carry package descriptors, package paths, raw APML,
  provider payloads, app data, tokens, or backend command strings

## K-AGCORE-056 Avatar Probe Result Envelope

Avatar debug probe results are Runtime-owned typed result envelopes that may
include Avatar-owned backend evidence refs.

Required fields:

- `probe_id`
- `agent_id`
- `probe_kind`
- `status`
- `observed_at`
- `evidence_refs`
- `reason_code`

`status` is one of:

- `passed`
- `failed`
- `unsupported`
- `blocked`
- `invalid`

Fixed rules:

- `passed` requires concrete Runtime or Avatar evidence
- `unsupported`, `blocked`, and `invalid` are terminal diagnostic outcomes
- results must not expose raw backend payloads or raw provider output
- Avatar backend facts may appear only as evidence refs or schema-bound evidence
  summaries admitted by Avatar contracts

## K-AGCORE-057 Avatar Debug Replay Keys

Runtime owns replay keys for avatar debug probes. The key set is pinned in
`tables/avatar-debug-replay-keys.yaml`.

Replay records must preserve:

- request envelope id
- result envelope id
- authorization verdict
- Runtime projection lineage
- Avatar backend evidence refs
- redaction state

Desktop may display replay links through SDK but must not reconstruct replay
from local UI state.

## K-AGCORE-058 Runtime Agent Event Projection Extension

Any app-facing avatar debug projection family must be pinned in
`tables/runtime-agent-event-projection.yaml`.

Admitted family names in this wave:

- `runtime.agent.avatar_debug.probe_requested`
- `runtime.agent.avatar_debug.probe_result`
- `runtime.agent.avatar_debug.replay_linked`

Fixed rules:

- these events are Runtime debug/probe projection families, not public APML
  syntax
- Avatar may consume these events only through typed SDK/Runtime projection
- Desktop may display these events only through typed SDK methods

## K-AGCORE-059 Provider And Delegation Boundary

If an avatar debug probe uses external provider evidence, it must pass through
the existing Runtime delegated gateway/firewall/audit path.

Desktop and Avatar must not directly consume MCP/A2A/delegated provider output
for avatar debug success.

## K-AGCORE-060 Later Implementation Status

Wave-1 admits contract and table truth only. Runtime implementation, SDK
methods, Desktop UI, and Avatar debug execution belong to later waves and must
not claim product support until their wave closeout evidence exists.
