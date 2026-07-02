# SDK Nimi Proposal Intake Client Contract

> Owner Domain: `S-PROP-*`

## Scope

This contract defines the SDK typed consumer surface for Platform proposal
intake admitted by `P-PROP-*`. The SDK owns the client shape, validation,
fail-closed behavior, and app-facing projection. Platform remains the
proposal-intake authority; the SDK does not own admission, execution, install,
permission grants, or review truth.

## S-PROP-001 - Sole SDK Access Path

`MUST`: Apps that create or read conversation-originated proposal intake
records MUST go through the SDK proposal-intake client surface. Direct
app-level REST calls, local files, renderer storage, private Runtime imports,
or app-local proposal stores are not admitted.

`MUST NOT`: The SDK surface MUST NOT expose an app-local bypass for Zhiyu or
any other first-party app.

## S-PROP-002 - Logical Operation Set

`MUST`: The SDK proposal-intake client admits these logical operations:

- `proposal.create(draft)` submits a typed proposal draft to the Platform
  proposal operation and returns a typed proposal intake record;
- `proposal.get(proposalId)` MAY read a proposal record when the Platform
  operation is available;
- `proposal.transition(proposalId, transition)` MAY submit an owner-reviewed
  state transition when the Platform operation is available.

`MUST NOT`: These operations MUST NOT install, execute, download, register,
grant permission, run code, select provider/model, or promote release state.

## S-PROP-003 - Record Shape Mirrors Platform Authority

`MUST`: SDK proposal records MUST preserve the `P-PROP-002` field set as
typed SDK fields: `proposalId`, `proposalKind`,
`sourceConversationAnchorId`, `requesterSubjectRef`, `ownerDomain`,
`requestedCapabilityRef`, `riskTier`, `requiredPermissionRefs`,
`nextReviewStep`, `state`, `reasonCode`, `auditRef`, and `createdAt`.

`MUST NOT`: The SDK MUST NOT collapse owner, risk, permission, next review
step, state, or audit fields into a generic text blob.

## S-PROP-004 - Closed Enum Preservation

`MUST`: The SDK MUST preserve the closed `P-PROP-003` proposal kind set and
the closed `P-PROP-004` state set as typed unions or equivalent enums.

`MUST NOT`: The SDK MUST NOT accept unknown kinds or states as opaque strings.
Unknown values fail closed.

## S-PROP-005 - Missing Platform Operation Fails Closed

`MUST`: When no Platform proposal operation is available, SDK
`proposal.create`, `proposal.get`, and `proposal.transition` MUST fail closed
with a typed SDK error. They MUST NOT synthesize a durable proposal record,
audit reference, or state transition.

`MUST NOT`: The SDK MUST NOT fabricate `proposalId`, `auditRef`, or
`accepted-for-admission` state to make a UI path appear successful.

## S-PROP-006 - Retired Alias And Non-Execution Guard

`MUST`: The SDK MUST reject drafts and returned records that try to route a
proposal through a retired `P-MOEX-*` alias family unless the proposal kind is
`rejected_request` or the state is `blocked` / `rejected` with a typed reason.

`MUST`: The SDK MUST reject drafts and returned records carrying execution,
provider/model, install, download, local path, or hidden command fields.

`MUST NOT`: The SDK MUST NOT turn a proposal into executable Runtime,
Workflow, app, package, or delegated-tool behavior.

## S-PROP-007 - Source Conversation Boundary

`MUST`: The SDK proposal draft MUST require `sourceConversationAnchorId` and
`requesterSubjectRef`. The SDK may carry a bounded
`requestedCapabilityRef`, but raw prompt transcript, private memory, provider
trace, or local app state is not proposal truth.

`MUST NOT`: The SDK MUST NOT store conversation bodies or app private state in
the proposal record.

## S-PROP-008 - App Consumer Projection Boundary

`MUST`: SDK consumers must render proposal state from the SDK returned record
or typed SDK error. An app may show a draft/capture UI, but durable proposal
truth remains the Platform-returned record.

`MUST NOT`: Apps must not persist alternate proposal truth, alternate review
state, or hidden success state when the SDK returns a fail-closed error.
