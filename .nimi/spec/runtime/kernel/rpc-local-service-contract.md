# RPC Runtime Local Service Contract

> Owner Domain: `K-RPC-*`

RuntimeLocalService method set and local state/config reconciliation authority.

This file is a semantic split from `rpc-surface.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-RPC-004 RuntimeLocalService 方法集合

`RuntimeLocalService` 是本地模型控制面的唯一稳定 RPC 面。local model / artifact 的清单、状态、health、audit、import/install/download、orphan adopt/scaffold 与 transfer/progress 必须全部由该服务持有；desktop 不得再拥有并回写第二套本地模型真源。

`RuntimeLocalService` 的 active method inventory、method type 与 proto
mapping 只由 `tables/rpc-methods.yaml` 和 `tables/rpc-migration-map.yaml`
维护。本节只定义 local lifecycle、catalog/intake、dependency、engine、
product-control 与 cutover families 的语义分层。

**Tier 1 — 核心生命周期：**

Tier 1 的读写边界固定如下：

- `ListLocalAssets` 只返回 runtime 已承认的 local asset inventory snapshot；它不是 probe、bootstrap、warm、recovery 或 status-normalization 入口。
- `CheckLocalAssetHealth` 是显式 health probe surface；它可以执行 endpoint probe 与 readiness projection，但必须 fail-close，并不得把 no-response / timeout 投影成可用。
- `StartLocalAsset` 与 `WarmLocalAsset` 是显式 lifecycle/readiness surface；它们可以启动受管引擎、执行 warm/minimal execution、更新 warm/status projection，并记录结构化失败。
- runtime-owned background health maintainer 可以异步维护 health projection，但它是 runtime 内部执行路径，不得被 Desktop/SDK/apps 以 list polling 方式替代或放大。

**Tier 2 — 目录、伴随资产、intake、recommendation 与 transfer：**

This family owns verified catalog reads, install-plan resolution, unregistered
asset scan/adoption, bundle intake, recommendation-feed projection, and local
transfer control.

**Tier 3 — 服务/节点/依赖/审计：**

This family owns local services, node catalog/profile resolution, selected
source records, environment dependency jobs, activation gate, runtime baseline
readiness evidence, first-run execution evidence, and local audit append/list
surfaces.

**Tier 4 — 引擎进程管理（K-LENG-004）：**

This family owns managed engine lifecycle/status projection. Desktop, SDK, and
apps must not maintain a second engine process truth.

**Tier 5 — product-control record (`<runtime_owner_state_root>/nimi.json`)：**

`RuntimeLocalService` owns the product-control record state-machine surface for
ordinary first-run setup. Desktop may expose bounded OS helpers such as a native
directory picker and default-path proposal, but record read/write, data-root
layout materialization, install-level validation, device-scan completion, and
every product-control record mutation through first-run setup/admission must go
through these Runtime methods. For Desktop-owned host evidence
(`accountDefaultProfileRef`, `builtInAiConfigRefs`), Desktop may submit explicit
backend-verified evidence JSON, but Runtime owns the authenticated account
check, Runtime baseline/execution re-resolution, failure routing, intermediate
state writes, and the atomic `ready_for_use` product-control record write.
`ReconcileProductControlFirstRunSetupState` is an empty-request Runtime
materialization reconciliation RPC: Runtime derives the non-ready setup state,
repair posture, and diagnostic reason from Runtime-owned first-run activation
and materialization evidence. Apps/SDK clients must not submit product-control
state or reason fields for this reconciliation.

The fixed production Runtime has no ordinary public TCP/HTTP listener. The
exact first-run and product-control method set listed under
`desktop_product_control` in
`tables/protected-local-rpc-transport-matrix.yaml` therefore runs only on the
mutually verified `desktop_control` connection after its current boot-scoped
Desktop session has opened. Registration of `RuntimeLocalService` on that
server does not admit the rest of the service: import/package, asset/model,
transfer, engine, local-service, audit, and unlisted method-id/bytes calls fail
before handler execution. Renderer metadata, portable credentials, and public
TCP cannot manufacture this carrier.

Runtime-managed shared accelerator dependency jobs are admitted under
`RuntimeLocalService` as the authority surface for supervised local engine
dependency materialization. For Windows NVIDIA CUDA accelerator dependencies,
the service must expose or project an equivalent runtime-owned
confirmation/job/status surface with these semantics:

- resolve dependency requirements from runtime authority, not Desktop probing
- return `needs_confirmation` / `materializable_requires_confirmation` before
  first network materialization of managed accelerator dependency packages
- start a runtime-owned install/repair job only after explicit user confirmation
  or an import/install confirmation that clearly covers the dependency
- project job states through the existing job state family (`QUEUED`,
  `RUNNING`, `COMPLETED`, `FAILED`, `CANCELED`) plus runtime-private phase detail
  such as `downloading`, `verifying`, and `installing`
- provide health/audit detail for `ready_system`, `ready_managed`, `failed`, and
  `repair_required`
- never require Desktop, SDK, apps, or a visible terminal to execute dependency
  installation scripts
- keep setup idempotent per dependency/environment; duplicate llama,
  stable-diffusion.cpp, and Python-native consumer requests must attach to the
  same active job and converge on one selected source record
- expose selected source record references in runtime-private audit/detail so
  consumers cannot independently re-resolve CUDA source

The dependency-first job-control RPC surface is:

- `StartLocalEnvironmentDependencyJob`
- `CancelLocalEnvironmentDependencyJob`
- `RetryLocalEnvironmentDependencyJob`
- `RepairLocalEnvironmentDependency`

These methods target Runtime dependency environments and Runtime job ids. They
must not target Desktop model rows, engine-local installers, shell scripts, or
local transfer ids as the source of dependency truth. Local transfer projection
may remain diagnostic/progress detail, but selected source records and local
environment dependency jobs are the authority for dependency readiness.

`ResolveLocalEnvironmentPlan` and `ResolveLocalEnvironmentActivationGate` must
carry explicit asset identity for `model.asset` and `model.companion-asset`
families. `asset_id` / `local_asset_id` identify the primary model payload;
`companion_asset_id` identifies the companion payload; `parent_asset_id`
identifies the parent asset binding when the caller already has it. Pack-level
placeholders such as `*.model-asset` or `*.companion-asset` are not valid
materializer execution identities and must fail closed instead of being promoted
to selected source records.

### K-RPC-004-state Runtime Local State And Config Reconciliation

`RuntimeLocalService` and the runtime config surface jointly own local AI state
and storage reconciliation. Runtime is the only active owner of local asset
state. Desktop, SDK, apps, and host helpers must not maintain a second local AI
state file or silently fall back to retired state files.

Runtime must distinguish these path roles:

- `localStatePath`: the single active Runtime local AI state file for assets,
  transfers, dependency assets, setup jobs, cutover evidence, and local health
  projection.
- `managedRoots.models`: the filesystem root for model and asset payload files,
  derived from `dataRootRef` unless explicitly reconciled by Runtime config.
- Nimi data dir: a product storage root that may contain models, caches,
  and dependency payloads, but is not itself local AI state truth.

When Desktop or another admitted host surface changes Nimi data dir, Runtime
must receive or produce a reconciliation plan before local AI state is assumed
usable. The plan must include the effective `localStatePath`, effective
`dataRootRef`, managed roots, dependency install root, detected retired state inputs,
asset counts, conflicts, and whether user confirmation is required.

Retired Desktop-local state such as `<nimi_data_dir>/state.json` may only be
used as an explicit cutover input. It must not be used as a live fallback,
secondary read source, or dual-write target. Cutover execution must be
idempotent and fail closed: failure leaves the previously active Runtime state
unchanged and projects `cutover_failed` / `repair_required` detail through
Runtime truth.

Required cutover states:

| State | Meaning |
| --- | --- |
| `not_required` | Runtime state/config already agree with the selected storage roots |
| `required_confirmation` | Runtime detected a retired state input or path mismatch and needs explicit user confirmation |
| `planned` | Runtime produced an accepted cutover plan but execution has not started |
| `running` | Runtime is validating, copying, or rewriting Runtime-owned local state |
| `succeeded` | Runtime completed cutover and retired the input from active use |
| `failed` | Runtime rejected or failed cutover without changing active truth |
| `cancelled` | User cancelled before state mutation |

No public state may report models as installed or dependencies as ready solely
because files exist under Nimi data dir. Runtime must have an authoritative
local asset record in the active Runtime state.

`WarmLocalAsset` 的语义限定为 runtime-owned 的”就绪/预热”路径：允许解析已安装 local model / local service，并在首次真实请求前触发最小执行以加载模型。对于 chat/text，本地模型在 `status in {installed, active}` 时可被选择，runtime 在首次真实 text 请求前负责 warm，不得要求 desktop 先行维持第二套 start/stop 真源。
