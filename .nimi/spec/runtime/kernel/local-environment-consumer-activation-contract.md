# Local Environment Consumer Activation Contract

> Owner Domain: `K-LENV-ACT-*`
> Delegated Anchors: `K-LENG-026`, `K-RPC-024`, `K-RPC-025`

RuntimeLocalService owns consumer activation for Runtime local environment
dependencies. This file defines how native engines, Python pipelines, SDK, and
Desktop consume Runtime-selected source records without creating setup truth.

Terminology boundary: `consumer_id` in this contract means Runtime local
environment activation consumer. It is not an app/module/feature capability
requirement owner, not an `AIScopeRef`, and not a Kit/Desktop UI consumer.
App/module/feature requirement declarations are owned by SDK `S-AICONF-010`;
Runtime activation consumers are downstream materialization/readiness consumers
selected after descriptor validation.

## K-LENV-ACT-001 Activation Authority

Activation is consumer-keyed and Runtime-owned. A caller may include `pack_id`
as projection context only after route resolution or setup planning has already
selected a consumer. Pack arbitration is upstream of activation unless a future
Runtime spec cut explicitly admits Runtime-side arbitration.

Consumers must not select sources, create selected source records, run
installers, repair dependencies, mutate PATH or global Python/package-manager
state, or project readiness. They may only consume activation gate responses
and selected source record projections.

Activation consumers must not be used as the identity of a live AIConfig slice
or as the required/optional requirement declaration. Mapping from
app/module/feature requirement to one or more activation consumers is explicit
projection metadata owned by the descriptor/readiness boundary
(`K-AIEXEC-008`, `K-AIEXEC-009`) and SDK requirement declaration
(`S-AICONF-010`).

## K-LENV-ACT-002 Request Contract

An activation request contains:

- `consumer_id`
- optional projection `pack_id`
- `host_profile_id`
- `platform_tuple`
- `runtime_data_root`
- `asset_id` for `model.asset`
- `companion_asset_id`, `companion_kind`, and `parent_asset_id` for
  `model.companion-asset`

`local_asset_id`, UI row ids, transfer ids, consumer ids, engine-private paths,
and route-local handles are projection only. They must not replace dependency
environment key material.

## K-LENV-ACT-003 Environment Key Derivation

Runtime derives one dependency environment key per required dependency family
using `tables/local-environment-dependencies.yaml`:

- `accelerator.cuda.runtime`: `dependency_id`, `host_profile_id`,
  `platform_tuple`, `runtime_data_root`
- `native-engine-package.llama`: `engine_id`, `package_variant`,
  `platform_tuple`, `runtime_data_root`
- `native-engine-package.stablediffusion-ggml`: `engine_id`,
  `backend_family`, `package_variant`, `platform_tuple`, `runtime_data_root`
- `python.tool.uv`: `tool_id`, `platform_tuple`, `runtime_data_root`
- `python.runtime`: `python_version`, `platform_tuple`, `runtime_data_root`
- `python.venv`: `engine_id`, `backend_family`, `python_version`,
  `package_lock_hash`, `platform_tuple`, `runtime_data_root`
- `python.package-set`: `engine_id`, `backend_family`, `package_lock_hash`,
  `platform_tuple`, `runtime_data_root`
- `python.torch-wheel`: `torch_version`, `accelerator_plane`, `cuda_abi`,
  `platform_tuple`, `runtime_data_root`
- `model.asset`: `asset_id`, `model_family`, `runtime_data_root`
- `model.companion-asset`: `asset_id`, `parent_asset_id`, `companion_kind`,
  `runtime_data_root`

Dependency environment identity is canonical. Consumer membership is projected
through the activation gate and selected source record `selected_consumers`.
`consumer_scope` is not key material unless a dependency family explicitly
admits consumer-scoped selected source ownership.

## K-LENV-ACT-004 Response Contract

An activation response contains:

- `consumer_id` and projection `pack_id`
- `activation_state`
- ordered blocking dependencies
- dependency entries with family, dependency id, environment key, required
  flag, selected source record id, source kind, canonical root, dependency
  state, reason code, and bounded diagnostic detail
- process-local activation environment deltas
- audit metadata including host profile and platform tuple

The response is ready only when every required dependency is `ready_system` or
`ready_managed` and every referenced selected source record passes repair,
compatibility, and verification checks.

## K-LENV-ACT-005 State Mapping

Activation state priority is:

1. `unsupported`
2. `repair_required`
3. `failed`
4. `cancelled`
5. `setup_in_progress`
6. `setup_required`
7. `ready`

`queued`, `downloading`, `verifying`, and `installing` project
`setup_in_progress`. `unknown` and `needs_confirmation` project
`setup_required`. Non-ready states must never project active, degraded-ready,
best-effort-ready, endpoint-ready, or import-ready.

## K-LENV-ACT-006 Process-Local Deltas

Activation deltas are process-local and consumable only after selected source
verification succeeds. Admitted deltas are:

- PATH prepend for selected CUDA runtime artifacts in the child process only
- executable path and canonical root references for native engine packages
- `UV`, Python interpreter, venv root, package environment, and wheel refs for
  Python pipelines
- selected model and companion asset paths

Deltas are not readiness proof. They must not write user PATH, machine PATH,
shell profiles, system CUDA, global Python, package-manager global state, or
engine-private persistent setup state.

## K-LENV-ACT-007 Reason Ownership

Activation reason codes are owned by
`tables/activation-gate-reason-codes.yaml`. A reason code must declare whether
it is owned by a dependency family, selected source record state, or
host-capability projection. Implementation must not invent unregistered
activation reason codes.

`vulkan_runtime_unavailable` and `metal_runtime_unavailable` are
host-capability projection reasons. They do not admit Vulkan or Metal
dependency materializers and must not create selected source records.

Speech driver readiness is part of `python.package-set` verification evidence.
Speech consumers use `python_package_set_missing`; they must not introduce a
separate engine-local speech driver installer.

## K-LENV-ACT-008 Consumer And Pack Semantics

Consumer requirements in
`tables/local-environment-consumer-requirements.yaml`, local compute pack
consumer refs in `tables/local-compute-packs.yaml`, and this contract must stay
in lockstep. There must be no orphaned consumer ids in either direction.

Pack-level optional dependency families are Desktop/setup projection only. They
must not weaken consumer-level required dependency evaluation once a specific
consumer is selected.

Cloud-only usage has no local consumer activation request and must not resolve
local environment dependencies.

## K-LENV-ACT-009 Forbidden Ready Inputs

Runtime must not project activation ready from file existence, directory
presence, endpoint reachability, transfer completion, package directory
presence, PATH precedence, import success, import directory contents, script
exit, process liveness, warmup success, or previous health success without a
ready selected source record.

## K-LENV-ACT-010 RPC Surface

RuntimeLocalService must expose activation gates through a named logical
operation: `ResolveLocalEnvironmentConsumerActivation`.

The operation accepts the request fields in `K-LENV-ACT-002` and returns the
response fields in `K-LENV-ACT-004`. The concrete transport may be a new RPC
method or a versioned extension of the existing local environment plan surface,
but the request, response, reason ownership, fail-closed state mapping, and
ordinary-user boundary in this contract are normative.

## K-LENV-ACT-011 First-Run Runtime Baseline Readiness Evidence

RuntimeLocalService owns `runtimeBaselineRef` for product first-run ready
admission. The ref is durable evidence for the selected local first-run baseline
activation state; it is not a route probe id, file path, process health result,
or renderer-supplied string.

`runtimeBaselineRef` is valid only when it resolves to:

- selected first-run local factory `AIProfile` ref and install level
- selected `runtime_data_root` / `dataRootRef`
- all required dependency families and selected source record ids for the
  selected baseline
- activation responses for each required consumer showing every required
  dependency as `ready_system` or `ready_managed` per `K-LENV-ACT-004`
- materialization job terminal evidence or system-source verification evidence
  that produced the selected source records
- `observed_at`, Runtime verifier identity, and audit/evidence sequence

Activation and materialization relation:

- materialization jobs may produce selected source records, but materialization
  success alone is not readiness
- activation consumes selected source records and verifies repair,
  compatibility, and dependency readiness for the selected consumer set
- `runtimeBaselineRef` can be minted only after activation succeeds for the
  selected baseline; a previous materialization terminal state cannot be reused
  without fresh activation verification

`MUST NOT`: file existence, directory presence, endpoint reachability,
`runtime.route.checkHealth`, process liveness, import success, route health,
transfer completion, script exit, warmup success, or previous health success may
mint or satisfy `runtimeBaselineRef` without the activation evidence above.
