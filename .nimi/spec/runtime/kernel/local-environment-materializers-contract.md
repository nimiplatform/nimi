# Local Environment Materializers Contract

> Owner Domain: `K-LENV-MAT-*`
> Delegated Anchors: `K-LENG-028`, `K-RPC-025`, `K-LENV-ACT-*`

This file owns the detailed runtime local environment materializer authority delegated from the Local Engine Contract and Runtime RPC Surface. It does not create a second truth owner; it keeps materializer rules in one AI-context-sized kernel spec while preserving the stable upstream anchors.

## K-LENG-028 Runtime Local Environment Materializers

Runtime materializers are the only admitted product path for materializing local
environment dependency families defined by
`tables/local-environment-dependencies.yaml`. The materializer registry is
`tables/local-environment-materializers.yaml`; source manifest schema families
are defined by `tables/local-environment-source-manifests.yaml`; verification
evidence schema families are defined by
`tables/local-environment-verification-evidence.yaml`.

The admitted materializer families are:

- `accelerator.cuda.runtime`
- `native-engine-package.llama`
- `native-engine-package.stablediffusion-ggml`
- `python.tool.uv`
- `python.runtime`
- `python.venv`
- `python.package-set`
- `python.torch-wheel`
- `model.asset`
- `model.companion-asset`

A materializer is a RuntimeLocalService-owned job executor. It consumes a
resolved dependency environment, source policy, source manifest, confirmation
disposition, and current selected source record. It stages artifacts under
Runtime-owned roots, verifies family-specific evidence, and promotes a selected
source record only after verification succeeds.

Materializers are not Desktop workflows, engine-local installers, developer
scripts, package-manager commands, PATH helpers, transfer records, endpoint
probes, or model rows. Engine startup, Python pipeline startup, route
resolution, provider health checks, passive import review, SDK reads, Desktop
page load, and background maintenance must not perform first heavy or network
materialization.

Missing `uv`, Python runtime, venv, package set, Torch wheel, native engine
package, model asset, or companion asset readiness must project Runtime local
environment setup, confirmation, failed, unsupported, cancelled, or repair
state. Ordinary users must not be instructed to install `uv`, Python, Torch,
CUDA, native packages, or model dependencies through a system package manager,
global Python environment, user PATH, machine PATH, shell profile, or
engine-private directory.

`native-engine-package.stablediffusion-ggml` source candidates are linked to
`tables/managed-image-backend-packages.yaml`, but selected source record
promotion remains owned by the local environment materializer. Runtime must not
infer a package source from engine startup branches, command-line backend
installers, or ad hoc code paths.

Explicit local imports may produce selected source records for `model.asset`
and `model.companion-asset` only. Imported paths must not become Python, `uv`,
CUDA, DLL, package-manager, Torch, or native engine package roots.

Selected source record identity is the dependency environment key. The
environment key is composed from the dependency family and family-specific key
fields in `tables/local-environment-dependencies.yaml`. `consumer_scope` is
not default key material; it is projection and activation-gate data unless a
future spec cut explicitly admits consumer-scoped selected source ownership for
a family. UI rows, transfer ids, consumer ids, model asset rows, and
engine-private paths must not replace the dependency environment key.

Runtime core readiness remains independent from materializers. Runtime may
reach core `READY` while local dependency jobs are missing, failed, cancelled,
unsupported, or repair-required; those states degrade local compute projections
without making RuntimeLocalService, RuntimeAuditService, or config/status
surfaces unavailable.

## K-RPC-025 RuntimeLocalService Materializer Projection Surface

RuntimeLocalService owns the app-facing projection and command surface for
Runtime local environment materializers. The concrete transport may be new RPC
methods or extensions to the existing local environment plan/job projection, but
the semantics are fixed:

1. Read the materializer registry for dependency families.
2. Resolve source candidates and source manifests from Runtime authority.
3. Project current selected source summaries with bounded diagnostics.
4. Project confirmation payloads before first network or storage-heavy
   materialization.
5. Start, observe, cancel, retry, and repair materializer jobs by dependency
   environment and Runtime job id.
6. Project activation gate failures without probing or installing dependencies.

Detailed consumer activation request, response, reason-code, and process-local
delta semantics are owned by
`local-environment-consumer-activation-contract.md`.

The surface must return Runtime setup or repair state for missing `uv`, Python
runtime, venv, package set, Torch wheel, native package, model asset, or
companion asset. It must not return ordinary-user instructions to install these
dependencies through a system package manager, global Python, user PATH, machine
PATH, shell profile, or engine-private directory.

Materializer projection must preserve the non-ready distinction between
`needs_confirmation`, `queued`, `downloading`, `verifying`, `installing`,
`repair_required`, `failed`, `unsupported`, and `cancelled`. Product-facing
setup-required or materializable-requires-confirmation text is a projection of
`needs_confirmation`; it is not a ready state.

Terminal dependency jobs must project typed `reason_code` and
`recovery_disposition` fields in addition to bounded diagnostic detail.
`failure_detail` remains human/debug context only; SDK, Desktop, Tester, and
other app consumers must not parse it to decide retry, auto-recovery, repair, or
setup-state transitions. Runtime owns the classification of interrupted,
manual-retry, repair-required, unsupported, and not-retryable outcomes.

Local transfer records may be included as progress or diagnostic detail only.
They must not target materializer commands, create selected source records, or
project readiness.

### K-RPC-025 Dependency-Job Download-Progress Projection

The dependency-job projection (`localEnvironmentDependencyJob`, returned by
`StartLocalEnvironmentDependencyJob` / `CancelLocalEnvironmentDependencyJob` /
`RetryLocalEnvironmentDependencyJob` / `RepairLocalEnvironmentDependency` and
listed by `ListLocalEnvironmentDependencyJobs`) carries a bounded
download-progress projection so a Desktop or SDK consumer can render a concrete
per-job percentage, transfer rate, and ETA while a job is fetching artifacts.
This is the fine-grained projection of the same byte progress the Runtime
transfer layer already tracks; it is diagnostic progress detail attached to the
job, never an alternate readiness or selection signal.

The job-progress fields are:

- `bytes_received` — bytes already fetched and on disk for the job's current
  artifact transfer, including any resumed prefix. `0` when the job has not yet
  fetched any bytes.
- `bytes_total` — the known final byte size of the job's current artifact
  transfer. `0` when the size is not yet known (no `Content-Length` /
  `Content-Range` observed yet).
- `percent` — an integer `0..100` completion projection. It is projected only
  when `bytes_total > 0`; when the total is unknown `percent` is `0` and the
  consumer must render an indeterminate progress affordance rather than a
  fabricated percentage.
- `speed_bytes_per_sec` — a bounded transfer-rate projection computed from
  observed bytes over observed elapsed time. It is projected only when a rate
  can actually be computed (elapsed time and received bytes are both positive);
  otherwise it is `0` (absent) and must not be fabricated or guessed.
- `eta_seconds` — a bounded remaining-time projection. It is projected only when
  `bytes_total > 0`, `speed_bytes_per_sec > 0`, and `bytes_received <
  bytes_total`; otherwise it is `0` (absent) and must not be fabricated.

The progress fields are meaningful only while a job is non-terminal and actively
materializing — that is, in `downloading` or `verifying`. For `unknown`,
`needs_confirmation`, `queued`, `installing`, every terminal state
(`ready_system`, `ready_managed`, `failed`, `unsupported`, `cancelled`), and
`repair_required`, the progress fields project zero/absent. They are never
back-filled, carried over, or fabricated for a state that is not actively
transferring bytes. A consumer must gate any percentage / rate / ETA display on
the `downloading` (and, where artifacts are still streaming, `verifying`) state
and must treat zero `speed_bytes_per_sec` / `eta_seconds` as "not yet known",
not as "stalled".

The progress projection does not change job lifecycle, selected-source
promotion, activation, or readiness semantics. A job is still ready only through
a verified selected source record; progress bytes never promote, never select,
and never substitute for verification evidence. The fields are a new optional
additive projection and are non-breaking.

### K-RPC-025 Install-Level Plan Resolution

`ResolveLocalEnvironmentPlan` carries an optional `install_level`
(`minimal` | `recommended` | unset) on `ResolveLocalEnvironmentPlanRequest`.
When `install_level` is set and the caller supplies no explicit `asset_id`,
RuntimeLocalService resolves the pack's `model.asset` and
`model.companion-asset` dependencies internally via the `K-MCAT-034`
deterministic resolver from the curated preset plus host posture. An explicit
`asset_id` always wins (the user-driven install/import path is unchanged); an
empty `install_level` preserves the prior explicit-identity behaviour. The
field is a new optional addition and is non-breaking.

A compute pack may host more than one preset model slot — `local-speech` hosts
both the `audio.transcribe` and `audio.synthesize` slots. The `model.asset`
dependency family per pack is therefore `1:N`, not exactly-1: under
install-level resolution the plan emits one `model.asset` dependency per
resolved preset slot whose capability the pack hosts, each carrying its own
resolver-filled `asset_id`. `model.companion-asset` follows the same pattern,
one dependency per resolved companion of those hosted slots. The N `model.asset`
rows do not collide because the `model.asset` environment key is keyed by
`asset_id` (`local-environment-dependencies.yaml`).

The `pack -> hosted capabilities` relation is explicit Runtime authority: each
compute pack declares the precise `K-MCAT-033` preset-slot capabilities it hosts
a model asset for (`local-text` -> `text.generate`; `local-speech` ->
`audio.transcribe` + `audio.synthesize`; `local-image-native` ->
`image.generate`). This is not the broad product-facing `capabilities` grouping
of `local-compute-packs.yaml`; it is the per-slot capability set used to project
resolved slots onto plan dependencies. The plan never keys this relation on
`consumer_scope`.

A resolver `FailClose` leaves the `model.asset` / `model.companion-asset`
dependency in `unsupported` state carrying the typed resolver reason code
(`K-MCAT-037`). The dependency keeps a non-empty `dependency_id` (the pack's
stable default model-family id) and is never projected as a ready or
startable dependency with an empty `dependency_id`.
