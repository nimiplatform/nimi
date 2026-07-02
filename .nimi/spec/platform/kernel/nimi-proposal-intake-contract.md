# Nimi Proposal Intake Contract

> Owner Domain: `P-PROP-*`

## Scope

This contract is the Platform-level authority for conversation-originated
proposal intake. It admits a non-executing proposal record that can be
created from a first-party product surface, reviewed by the correct owner,
and handed off to an existing admission or execution authority only after
that owner accepts the handoff.

This contract does not own and MUST NOT redefine:

- Nimi App admission, release descriptor, registry, trust tier, or PR
  admission authority. Those remain `P-NAPP-*`, `P-DEV-*`, and
  `P-AUDIT-*` authority;
- permission grant, scope taxonomy, spend, or consent authority. Those
  remain `P-PERM-*` authority;
- retired `P-MOEX-*` surfaces or any alias family that would revive them;
- Runtime delegated execution, tool execution, provider selection,
  workflow execution, package install, app install, or code loading;
- app-local storage, app-local proposal truth, prompt transcript truth, or
  source conversation ownership.

## P-PROP Family Seam (OWNS / DOES NOT OWN)

`P-PROP-*` OWNS:

- the conversation-originated proposal intake record identity and required
  field set (`P-PROP-001`, `P-PROP-002`);
- the closed proposal kind set and the meaning of each proposal kind
  (`P-PROP-003`);
- the proposal state machine for intake review (`P-PROP-004`);
- the handoff boundary from proposal intake to existing owner domains
  (`P-PROP-005`);
- the source conversation anchor reference boundary (`P-PROP-006`);
- the proposal transition audit obligation (`P-PROP-007`);
- the SDK and app consumer boundary for proposal intake (`P-PROP-008`).

`P-PROP-*` DOES NOT OWN:

- `P-NAPP-*` Nimi App admission, release descriptor, registry, trust tier,
  or ordinary-user visibility authority;
- `P-DEV-*` developer repository workflow or PR submit substrate authority;
- `P-AUDIT-*` publish-to-admission gate, evidence, review, or admit
  authority;
- `P-PERM-*` permission taxonomy, grants, spend, or consent authority;
- Runtime delegated execution or tool execution authority;
- Workflow execution authority before such authority is admitted elsewhere;
- any app-local proposal store, app-local app admission truth, or app-local
  request-review state machine.

`P-PROP-*` is an intake-only authority. It can record that a user asked for
new capability, route that request to an owner, and preserve the review
state of that intake record. It cannot make the requested capability real,
installed, executable, admitted, granted, or provider-bound.

## P-PROP-001 - Proposal Intake Authority And Non-Execution

`MUST`: A conversation-originated proposal MUST be represented as a
Platform-owned proposal intake record before any first-party app presents it
as a durable request, queued capability, review item, or future handoff.
The proposal record is the only admitted durable intake shape for this
surface.

`MUST`: Proposal intake is non-executing. Creating, updating, submitting, or
closing a proposal MUST NOT install an app, register a Runtime service,
grant a permission, load code, start a workflow, invoke a delegated tool,
select a provider, select a model, mutate user data outside the proposal
record, or make a release visible to ordinary users.

`MUST NOT`: A first-party app MUST NOT substitute an app-local draft table,
renderer state, prompt transcript, local file, or UI-only card for the
Platform-owned proposal intake record. Such state may render a pending
interaction only until the Platform/SDK proposal intake operation returns a
typed result; it is not durable proposal truth.

`MUST NOT`: A proposal record MUST NOT be used as proof that a capability,
workflow, Nimi App, delegated tool, permission scope, package, or release is
admitted. A proposal can only point to the next owner review step.

## P-PROP-002 - Proposal Record Shape

`MUST`: Every proposal intake record MUST carry the following required
fields:

| Field | Required meaning |
|---|---|
| `proposal_id` | Platform-minted stable proposal identity. Apps and SDKs must not mint durable IDs outside the Platform/SDK proposal operation. |
| `proposal_kind` | One of the closed values admitted by `P-PROP-003`. |
| `source_conversation_anchor_id` | Reference to the conversation anchor that produced the proposal request; reference-only per `P-PROP-006`. |
| `requester_subject_ref` | Account, agent, or participant subject reference for the requester. |
| `owner_domain` | The owner domain selected for review, such as Platform, Runtime, Workflow, SDK, Desktop, Avatar, Kit, Cognition, or a future admitted app owner. |
| `requested_capability_ref` | Stable reference to the requested capability, app request, workflow draft request, delegated tool request, or rejected request summary. |
| `risk_tier` | Closed review risk tier selected by Platform policy for intake triage. |
| `required_permission_refs` | Explicit list of permission scope references expected if the proposal later becomes executable or installable. Empty is meaningful and must be represented as an empty list. |
| `next_review_step` | Human- and machine-readable next owner action, not an execution command. |
| `state` | One of the closed states admitted by `P-PROP-004`. |
| `reason_code` | Typed reason for the current state, including blocked and rejected outcomes. |
| `audit_ref` | Audit-event or audit-pending reference admitted by `P-PROP-007`. |
| `created_at` | Platform timestamp for proposal creation. |

`MUST`: `proposal_id`, `proposal_kind`, `owner_domain`, `state`,
`reason_code`, `audit_ref`, and `created_at` are required on every record,
including `rejected_request`. A rejected request may use a bounded
`requested_capability_ref` that points to a redacted request summary rather
than a future capability identity.

`MUST NOT`: The record shape MUST NOT carry executable code, prompt bodies,
provider names, model names, install commands, hidden permission grants,
unreviewed package locators, local filesystem paths, or app-local admission
flags.

## P-PROP-003 - Closed Proposal Kind Set

`MUST`: `proposal_kind` MUST be one of:

| Proposal kind | Meaning |
|---|---|
| `capability_proposal` | Request for an owner to evaluate a new capability or capability-surface identity. |
| `workflow_draft_request` | Request to draft a future workflow under an admitted workflow authority. Until that authority exists, the proposal must remain non-executing and may only move to `blocked` or owner review states. |
| `nimi_app_request` | Request to evaluate a future Nimi App candidate or app request. It is not a PR, registry row, descriptor, install source, or admission decision. |
| `delegated_tool_request` | Request to evaluate whether a delegated tool action should be routed to the Runtime/delegation owner. It does not invoke or authorize the tool. |
| `rejected_request` | Request that is refused at intake because it is out of scope, unsafe, owned by no admitted authority, duplicates an existing rejected request, or attempts a forbidden shortcut. |

`MUST`: `proposal_kind` is closed. Adding a kind requires changing this
Platform contract and its downstream SDK/app projections.

`MUST NOT`: Proposal intake MUST NOT admit a kind that revives any retired
`P-MOEX-*` surface by direct name or alias, including content-pack,
plugin, worker, vm, hook-based capability, shared package channel, or
installable extension semantics. A request using those aliases MUST become
`rejected_request` or `blocked` with a typed `reason_code`.

## P-PROP-004 - Proposal State Machine

`MUST`: `state` MUST be one of:

| State | Meaning |
|---|---|
| `draft` | Platform has accepted an intake draft but it is not submitted for owner review. |
| `submitted` | The proposal is submitted to the selected owner domain for triage. |
| `under-review` | The selected owner domain is reviewing the proposal. |
| `revision-requested` | The selected owner requires more information or a revised request. |
| `rejected` | The proposal is terminally refused. |
| `accepted-for-admission` | The selected owner accepted the proposal for a separate admitted admission, implementation, or execution path. This is not itself admission or execution. |
| `blocked` | The proposal cannot advance because required owner authority, schema, permission, audit, or implementation authority is absent. |

`MUST`: Every state transition MUST set a typed `reason_code` and update
`audit_ref` according to `P-PROP-007`.

`MUST NOT`: `accepted-for-admission` MUST NOT be treated as `approved`,
`admitted`, `installed`, `enabled`, `granted`, `running`, or `visible to
ordinary users`. It only permits the next owner-owned process to begin
under that owner's admitted authority.

`MUST NOT`: Proposal intake MUST NOT reuse the `P-ECO-004` review-state set
or `P-NAPP-025` review-decision schema as Nimi App admission truth. Proposal
states are intake-review states only.

## P-PROP-005 - Owner Handoff Boundary

`MUST`: A proposal handoff MUST name an owner domain and a next review step.
The proposal record may carry references needed by the owner, but the owner
must perform its own admitted validation before any admission, execution,
install, permission grant, or workflow run occurs.

`MUST`: A `nimi_app_request` can only hand off to `P-DEV-*`, `P-NAPP-*`,
and `P-AUDIT-*` surfaces through their existing PR and admission path. The
proposal record does not satisfy `P-DEV-002` `submit`, does not create a
registry row, and does not create a release descriptor.

`MUST`: A `delegated_tool_request` can only hand off to Runtime/delegation
authority after the Runtime owner accepts the request. The proposal record
does not grant delegation, does not invoke the tool, and does not satisfy
permission or consent requirements.

`MUST`: A `workflow_draft_request` MUST remain non-executing while no
workflow execution authority exists. In that posture, owner review may
record `blocked` with a typed reason and a concrete missing-authority
reference; it may not create a hidden workflow runner.

`MUST NOT`: A handoff MUST NOT cross directly from proposal intake to
install, execution, provider/model selection, permission grant, or release
promotion. Every handoff is owner-review input only.

## P-PROP-006 - Source Conversation Anchor Boundary

`MUST`: `source_conversation_anchor_id` is a reference to the conversation
continuity surface that produced the request. It preserves provenance and
review traceability without transferring transcript ownership into the
proposal record.

`MUST`: Any natural-language request summary carried by
`requested_capability_ref` or an attached review artifact MUST be bounded,
redacted when needed, and treated as review input only. Transcript bodies,
private memory records, and app-local chat state remain under their
existing owners.

`MUST NOT`: A proposal intake record MUST NOT store raw prompt transcripts,
private memory blobs, provider traces, local account secrets, or app-owned
conversation state as Platform proposal truth.

## P-PROP-007 - Proposal Transition Audit Obligation

`MUST`: Every proposal creation and state transition MUST produce a typed
audit reference in `audit_ref`. The audit record or audit-pending record
MUST include `proposal_id`, `from_state` when applicable, `to_state`,
`transition_cause`, `decided_at`, and `adjudicator_ref` or
`system_adjudicator_ref`.

`MUST`: When audit infrastructure for a consumer is unavailable, the
proposal operation MUST fail closed or return a typed `blocked` result with
`reason_code=proposal_audit_unavailable`. It MUST NOT fabricate a pass
audit reference.

`MUST NOT`: First-party apps MUST NOT mint synthetic audit references for
proposal state transitions. Apps may display the Platform/SDK returned
`audit_ref` only.

## P-PROP-008 - SDK And App Consumer Boundary

`MUST`: SDK projections of proposal intake MUST expose typed proposal
creation/read/update results that preserve the closed `proposal_kind`,
`state`, required field set, and non-execution semantics admitted in this
contract.

`MUST`: Apps consuming proposal intake MUST render proposal state from the
SDK/Platform result and fail closed when that result is absent, rejected, or
blocked. App consumers may compose UX around the proposal, but they must not
create a parallel state machine or durable app-local proposal truth.

`MUST NOT`: Apps MUST NOT bypass SDK/Platform proposal intake with app-level
REST calls, local files, renderer-only persistence, or direct Runtime
private imports. Consumer implementation must preserve the existing
boundary rules for Desktop/Web, SDK, and Runtime.

`MUST NOT`: SDK or app projections MUST NOT hardcode provider names, model
names, owner-specific execution paths, or alias surfaces forbidden by
`P-PROP-003`.
