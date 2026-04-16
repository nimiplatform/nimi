# Cognition Family Contract

> Owner Domain: `C-COG-*`

## C-COG-019 Family Registry

The authoritative standalone cognition family registry is `tables/artifact-families.yaml`.

Fixed rules:

- every admitted cognition family must appear exactly once in the registry
- every registered family must declare truth weight, persistence mode, prompt lane, cleanup lane, and owner surface
- adding a new cognition family requires an admitted kernel rule rather than ad hoc package growth
- family registration is semantic admission, not a naming convenience for packages or folders

## C-COG-020 Scope And Identity Model

Every durable cognition artifact belongs to exactly one cognition scope.

Fixed rules:

- kernels, memory records, knowledge pages, and skill bundles are scope-owned artifacts
- family-local identifiers must be unique within one scope
- cross-scope references are not admitted
- one cognition scope contains exactly one `agent_model_kernel` and one `world_model_kernel`
- deleting a cognition scope must remove durable scope-owned artifacts and clear transient working state for that scope

## C-COG-021 Family Truth Weight And Serving Order

Standalone cognition serving order is family-sensitive rather than storage-sensitive.

Fixed rules:

- `agent_model_kernel` and `world_model_kernel` are the only core local-model truth families
- `memory_substrate`, `knowledge_projections`, and `skill_artifacts` are advisory families and must remain subordinate to kernel truth
- `working_state` is transient scaffolding and must never be served as admitted truth
- routine evidence is not a first-order cognition family and must not be promoted into prompt or retrieval truth by default
- kernel truth may cite advisory artifacts through typed outgoing refs, but that
  citation posture does not demote kernels or promote advisory families into
  kernel truth owners

## C-COG-022 Persistence And Transience Boundary

Standalone cognition must keep durable and transient families explicitly separated.

Fixed rules:

- durable families persist through the standalone cognition store
- `working_state` remains transient unless a later cognition rule explicitly admits persistence
- transient state must not silently leak into durable search, refgraph, digest, or prompt lanes
- routine evidence may persist as external-worker evidence, but that persistence does not make it a cognition family

## C-COG-023 Typed Reference Integrity

Cross-artifact references must remain typed and fail-closed.

Fixed rules:

- reference targets must be expressed as typed family-qualified artifact references rather than untyped free-form links
- save paths must reject missing targets, illegal target families, and illegal scope crossings
- cross-family references are admitted only where the cognition family contract explicitly permits them
- admitted cross-family reference permission is defined by `tables/admitted-reference-matrix.yaml`
- storing an artifact with unresolvable or illegal references is not admitted as partial success

## C-COG-024 Cleanup Eligibility Boundary

Cleanup eligibility is family-specific.

Fixed rules:

- kernels are never digest cleanup targets
- `working_state` admits only explicit clear semantics, not digest cleanup
- `memory_substrate`, `knowledge_projections`, and `skill_artifacts` are the only admitted digest target families
- routine evidence must not be treated as a hidden fourth cleanup lane for cognition truth

## C-COG-025 Storage Envelope And Fail-Closed Validation

Standalone cognition storage must validate by family semantics before commit.

Fixed rules:

- every admitted stored artifact must be validated against its family-specific payload contract before persistence
- one family must not be able to impersonate another through a generic envelope or mislabeled kind
- caller-owned payload must not carry service-owned derived metadata as if it were durable truth
- fail-closed validation applies before mutation commit, not only at read time
