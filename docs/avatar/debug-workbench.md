# Debug Workbench

## Status: Admitted as platform direction

The debug workbench is defined as a contract across Avatar (intake
and backend evidence) and Runtime (probe envelopes and replay). The
user-facing workbench tooling is agreed direction; it is not a public
app API today.

## What the Debug Workbench Is

The workbench is the surface where a developer can **probe** an
Avatar instance — ask "does this backend support generated motion?",
"does this voice route lipsync?", "does this hit region resolve?" —
and get a typed result with replayable evidence.

Responsibility for probes is split deliberately, so the answers stay
trustworthy:

- **Runtime** defines the probe request / result / replay semantics.
  A probe is a runtime-typed envelope, and Runtime validates the
  caller before projecting it.
- **Avatar** produces the backend evidence. When a probe asks
  something backend-specific (capability profile validation,
  generated motion route support, carrier diagnostics), Avatar
  supplies the evidence refs.
- **Desktop** owns the workbench layout — the eventual UI that
  initiates probes and renders results.

## Probe Request Envelope (Runtime-Owned)

| Field | Required? | Notes |
| --- | --- | --- |
| `probe_id` | yes | Unique per probe |
| `agent_id` | yes | Authorized agent target |
| `conversation_anchor_id` | yes | Anchor scope |
| `probe_kind` | yes | Pinned in `tables/avatar-debug-probe-events.yaml` |
| `requested_at` | yes | ISO-8601 |
| `requested_by` | yes | Identity of requester |
| `turn_id` / `stream_id` / `avatar_instance_id` / `runtime_replay_ref` | optional | Trace fields |

Forbidden in a probe request:

- package descriptors / package paths (Desktop must not inject these)
- raw APML / MCP / A2A provider payloads
- tokens, account ids, user ids, Realm URLs, auth material
- backend command strings

## Probe Result Envelope (Runtime-Owned)

| Field | Required? | Notes |
| --- | --- | --- |
| `probe_id` | yes | Matches request |
| `agent_id` | yes | — |
| `probe_kind` | yes | — |
| `status` | yes | `passed` / `failed` / `unsupported` / `blocked` / `invalid` |
| `observed_at` | yes | ISO-8601 |
| `evidence_refs` | yes | Avatar-owned evidence refs admitted by Avatar contracts |
| `reason_code` | yes | Typed |

`passed` requires concrete evidence. `unsupported` / `blocked` /
`invalid` are terminal diagnostic outcomes. Results never expose raw
backend payloads.

## Avatar Backend Evidence

Avatar produces evidence for:

- package descriptor resolver execution
- backend load outcome
- backend capability profile validation
- generated motion route support
- emotion / expression support
- speech / lipsync support
- carrier diagnostics and hit region evidence

Evidence shape is pinned by `tables/avatar-debug-session.schema.yaml`.
Avatar performs resolver execution after authorized runtime / SDK
projection — Desktop stores opaque refs only; Runtime owns
authorization; SDK carries typed refs and methods.

## Replay Keys

Runtime owns replay keys for avatar debug probes. The key set is
pinned in `tables/avatar-debug-replay-keys.yaml`. Replay records
must preserve the typed envelope, authorization context, and the
Avatar-owned evidence refs so a later auditor can reproduce the
result deterministically.

## Reader Scenario: Probing Generated Motion Route Support

1. **Developer initiates probe.** Workbench surface emits a runtime
   probe request: `probe_kind: generated_motion_route_support`,
   target `agent_id`, optional `avatar_instance_id`.
2. **Runtime authorizes + projects.** Validates the requester, casts
   the probe into the `runtime.agent.*` projection space.
3. **Avatar evaluates.** Resolves the package descriptor, validates
   the backend capability profile, checks the route id against
   `tables/generated-motion-routes.yaml`, produces evidence refs
   describing what the backend supports.
4. **Runtime returns the result envelope.** `status: passed` with
   evidence refs, or `unsupported` with a reason code if the route
   isn't admitted on this backend.
5. **Auditor replay.** Runtime replay reproduces the result without
   re-asking the live backend; the evidence refs anchor the proof.

## Reader Scenario: A `.vrma` File Is Not Debug Success Proof

1. **Probe expects backend execution evidence.**
2. **A `.vrma` file is found.** Interchange / authoring evidence —
   useful, but not runtime support proof.
3. **Runtime / Avatar fail closed.** `.vrma` cannot mark the probe as
   `passed`. Result is `unsupported` (or whatever the backend's
   actual support is) with the typed reason code.

The contract is explicit because authoring artifacts often look like
success without exercising the runtime path. The workbench is built
to refuse that substitution.

## What the Workbench Does Not Do

- It does not own SDK method shape — SDK carries typed refs only.
- It does not own Desktop product layout — that's a Desktop concern.
- It does not own APML public wire — runtime owns wire authority.
- It does not own delegated provider access — provider integrations
  are admitted independently.
- It does not silently report `unsupported` capabilities as success
  through idle fallback or static image fallback.

## Boundary Summary

| Concern | Owner | Surface |
| --- | --- | --- |
| Probe request / result envelope + replay | Runtime | `avatar-debug-projection-contract.md` (K-AGCORE-054..060) |
| Backend evidence | Avatar | `avatar-debug-session-contract.md` |
| Workbench UX | Desktop | Not a public app API today |

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
