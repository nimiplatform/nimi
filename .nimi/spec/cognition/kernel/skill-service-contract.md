# Cognition Skill Service Contract

> Owner Domain: `C-COG-*`

## C-COG-056 Skill Service Operation Registry

The authoritative standalone cognition skill operation registry is
`tables/skill-service-operations.yaml`.

Fixed rules:

- every admitted skill service operation must appear in the registry exactly
  once
- every registered skill operation must declare admitted inputs, identity
  invariants, validation posture, retrieval posture, lifecycle effects,
  derived-view behavior, fail-closed reasons, and non-ownership boundary
- skill capability admission must be grounded in this registry rather than
  inferred from envelope shape or package naming alone

## C-COG-057 Skill Lifecycle, Retrieval, And History Semantics

Standalone cognition skill owns local advisory bundle lifecycle and retrieval.

Fixed rules:

- skill save/update semantics must remain explicit for one bundle in one
  cognition scope
- validated skill bundles must require non-empty ordered steps and fail-close
  on duplicate step identity, duplicate order, illegal refs, or illegal scope
  crossing
- explicit delete semantics are required for skill ownership; digest-triggered
  lifecycle transitions must remain archive/remove outcomes rather than hidden
  hard delete
- skill list/search surfaces must exclude removed bundles by default, while
  load/history must keep removed lifecycle outcomes explicitly observable until
  explicit delete
- skill history must expose created, updated, archived, removed, and deleted
  transitions rather than forcing clients to infer lifecycle from current
  bundle snapshot alone

## C-COG-058 Skill Non-Ownership Boundary

Standalone cognition skill remains separate from runtime execution
orchestration.

Fixed rules:

- skill service does not own runtime scheduler truth, provider/tool routing,
  automation execution policy, or control-plane state
- standalone skill lifecycle and retrieval semantics do not authorize cognition
  to absorb runtime execution-policy or workflow ownership
- validated skill artifacts may participate in prompt serving and digest
  cleanup, but that does not make cognition a runtime automation owner
