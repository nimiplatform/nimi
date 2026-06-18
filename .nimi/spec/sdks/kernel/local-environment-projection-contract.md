# SDK Local Environment Projection Contract

> Owner Domain: `S-RUNTIME-*`

## S-RUNTIME-119 Runtime Local Environment Projection

SDK may expose typed projection for Runtime local environment plans only as a
downstream mirror of Runtime truth. The Runtime authority source is
`.nimi/spec/runtime/kernel/local-engine-contract.md` `K-LENG-024` through
`K-LENG-028` and the local environment tables under
`.nimi/spec/runtime/kernel/tables/`.

Allowed SDK projection families:

- host capability profile projection
- local compute pack projection
- local environment plan projection
- dependency graph and dependency job projection
- materializer family and status projection
- source manifest and verification evidence summaries, bounded to diagnostics
- selected source record reference and diagnostics projection
- confirmation, cancel, retry, and repair commands routed to Runtime
- activation gate status for native engine and Python pipeline consumers

Dependency job-control projection is dependency-first:

- `startLocalEnvironmentDependencyJob` must require a Runtime-resolved
  dependency environment and explicit confirmation.
- `model.asset` and `model.companion-asset` projections must preserve Runtime
  asset-specific identity fields. SDK must not replace concrete
  `asset_id`, `local_asset_id`, `companion_asset_id`, or `parent_asset_id`
  truth with pack-level placeholders.
- SDK and app helpers must not synthesize `asset_id` from `local_asset_id`.
  When both are projected, `asset_id` remains the semantic installable asset
  identity and `local_asset_id` remains the lifecycle handle. Lookup or dedupe
  helpers that need a fallback key must keep the two namespaces typed rather
  than normalizing both through one asset-id canonicalizer.
- `cancelLocalEnvironmentDependencyJob` targets only Runtime job ids.
- `retryLocalEnvironmentDependencyJob` targets terminal retryable Runtime job
  ids and must preserve Runtime structured failure when retry is refused.
- `repairLocalEnvironmentDependency` targets Runtime dependency environments and
  must not become SDK-side installer, package-manager, PATH, or source-selection
  logic.
- Dependency job recovery helpers may filter Runtime-projected
  `recovery_disposition` values, but must not parse `failure_detail` or
  dependency-family names to infer auto-recovery policy.

SDK must not own or infer:

- GPU, CUDA, Python, uv, Torch, package set, model directory, PATH, or engine
  package readiness
- dependency source selection
- selected source record creation or invalidation
- installer, script, package manager, PATH mutation, or repair execution
- app-level REST bypass around RuntimeLocalService
- materializer source manifests or verification evidence outside Runtime
- readiness from endpoint reachability, transfer completion, package directory
  presence, import success, PATH precedence, or script exit

SDK must preserve Runtime structured failure, cancellation, unsupported,
repair-required, auth, and stale-projection reasons. It must not synthesize
`ready` from missing, unconfirmed, cancelled, failed, unsupported, corrupt,
incompatible, stale, or repair-required Runtime state.

Cloud-only SDK provider, connector, account, and route projection paths must not
depend on local environment readiness.

Missing `uv`, Python runtime, venv, package set, Torch wheel, native engine
package, model asset, or companion asset must be projected as Runtime local
environment setup, confirmation, failed, unsupported, cancelled, or repair
state. SDK public errors and helper text must not instruct ordinary users to
install these dependencies through system package managers, global Python, user
PATH, machine PATH, shell profiles, or engine-private directories.
