# SDK Local Environment Projection Contract

> Owner Domain: `S-RUNTIME-*`

## S-RUNTIME-109 Runtime Local Environment Projection

SDK may expose typed projection for Runtime local environment plans only as a
downstream mirror of Runtime truth. The Runtime authority source is
`.nimi/spec/runtime/kernel/local-engine-contract.md` `K-LENG-024` through
`K-LENG-027` and the local environment tables under
`.nimi/spec/runtime/kernel/tables/`.

Allowed SDK projection families:

- host capability profile projection
- local compute pack projection
- local environment plan projection
- dependency graph and dependency job projection
- selected source record reference and diagnostics projection
- confirmation, cancel, retry, and repair commands routed to Runtime
- activation gate status for native engine and Python pipeline consumers

Dependency job-control projection is dependency-first:

- `startLocalEnvironmentDependencyJob` must require a Runtime-resolved
  dependency environment and explicit confirmation.
- `cancelLocalEnvironmentDependencyJob` targets only Runtime job ids.
- `retryLocalEnvironmentDependencyJob` targets terminal retryable Runtime job
  ids and must preserve Runtime structured failure when retry is refused.
- `repairLocalEnvironmentDependency` targets Runtime dependency environments and
  must not become SDK-side installer, package-manager, PATH, or source-selection
  logic.

SDK must not own or infer:

- GPU, CUDA, Python, uv, Torch, package set, model directory, PATH, or engine
  package readiness
- dependency source selection
- selected source record creation or invalidation
- installer, script, package manager, PATH mutation, or repair execution
- app-level REST bypass around RuntimeLocalService

SDK must preserve Runtime structured failure, cancellation, unsupported,
repair-required, auth, and stale-projection reasons. It must not synthesize
`ready` from missing, unconfirmed, cancelled, failed, unsupported, corrupt,
incompatible, stale, or repair-required Runtime state.

Cloud-only SDK provider, connector, account, and route projection paths must not
depend on local environment readiness.
