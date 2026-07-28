# Runtime Service Operations - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/runtime/service-operations.authority.yaml`。

---

<!-- source: .nimi/spec/runtime/kernel/rpc-local-service-contract.md -->

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

---

<!-- source: .nimi/spec/runtime/kernel/runtime-artifact-contract.md -->

# Runtime Artifact Contract

source_rule: K-AGCORE-053

## Purpose

Runtime owns artifact identity and read audience. Authorized consumer apps
must be able to retrieve artifact bytes by `artifact_id` for
artifacts emitted in runtime events (e.g.
`voice_playback_requested.audio_artifact_id`,
`lipsync_frame_batch.audio_artifact_id`). This contract admits the
authoritative read-bytes-by-id surface only when the current protected caller
matches the durable artifact audience,
orthogonal to existing typed media projections
(`getScenarioArtifacts(jobId)` per S-RUNTIME-073) and voice asset
library (`getVoiceAsset`).

## K-AGCORE-053 Runtime Artifact Bytes Retrieval

Runtime must expose a generic `ReadArtifactBytes` RPC that returns the
full artifact body for a given `artifact_id`. The RPC and its supporting
identity / lifecycle / fail-close semantics are admitted as fixed rules.

### Identity

`artifact_id` is a runtime-owned, opaque, globally-unique identity emitted in
runtime events (e.g. `voice_playback_requested.audio_artifact_id`). Consumers
must treat it as a string; format may evolve. The runtime guarantees:

- artifact_id is stable for the lifetime of the artifact
- artifact_id namespace is flat (not hierarchical); no jobId/scenarioId prefix
  required for retrieval
- artifact_id is unique within a runtime instance; across runtime instances
  uniqueness is not guaranteed (consumers must scope retrieval to their
  authoritative runtime client)
- artifact_id is a selector, never a credential or authorization proof; a
  guessed, observed, replayed, or cross-app id cannot authorize a read

### Lifecycle

artifact lifecycle is owned by runtime:

- created when a runtime-side producer (TTS provider / scenario job / realtime
  session / local voice engine / cache / streaming TTS / user upload) materializes bytes
- referenced by emit events (e.g. voice_playback_requested) carrying its id
- bytes retrieval is best-effort idempotent: same id returns same bytes if
  artifact still in storage
- TTL / GC / quota policies are runtime implementation detail except for
  generated agent voice artifacts admitted by `K-VOICE-020`, which must remain
  durable on the user's local disk until explicit user cleanup or a later
  admitted quota policy removes them
- emitter-side invariant: `Store.Put(artifact_id, bytes, mime_type)` must
  complete BEFORE the runtime emit event referencing the id (e.g.
  `voice_playback_requested`); violation logs fatal at the emitter site
- every record exposed through `ReadArtifactBytes` binds producer job, owner
  account when applicable, initiating `local_app_principal_id` for third-party
  local-app work, the exact principal-lineage branch (immutable
  `immutable_lineage_id` or development authorization + canonical project-file
  identity), host/payload digest slots, producing
  session, account generation, allowed use, observed byte size, content SHA-256
  and expiry; `app_id` remains display/routing metadata only
- internal or historical records without that complete audience may remain in
  Runtime-owned storage but are not externally readable and fail closed
- once an artifact id is written, bytes, MIME, observed size, content hash and
  audience are immutable. The generated-voice producer may atomically enrich
  an otherwise identical record from absent metadata to its complete
  `GeneratedVoiceArtifactMetadata` before the referencing event; it cannot
  replace content or audience.

### Voice Artifact Identity

Generated assistant voice artifact ids must identify playable audio bytes only.

Fixed rules:

- `voice_playback_requested.detail.audio_artifact_id` must resolve through
  `ReadArtifactBytes` to bytes whose returned `mime_type` starts with `audio/`
  unless the event is a terminal failed/interrupted/canceled state that carries a
  reason and is not requesting playback.
- Runtime must not store lipsync metadata, timing metadata, debug records, or
  synthetic placeholders under the same id used as a playable audio artifact id.
- Provider-returned audio artifact identity must not be overwritten by
  runtime-generated lipsync metadata.
- If Runtime emits separate lipsync/timing/debug artifacts, those ids must be
  distinct from the audio artifact id and must declare their own mime type.
- A text-only fallback or unavailable TTS route must not create a pseudo audio
  artifact and must not emit a playable voice request.

### Generated Agent Voice Retention

Generated assistant voice audio is a durable local Runtime artifact class.

Minimum stored metadata for this class:

- `agent_id`
- `conversation_anchor_id`
- `turn_id`
- `message_id`
- `voice_reference`
- `speech_model_id`
- `route_policy`
- `mime_type`
- `byte_digest`
- `created_at`
- `retention_scope`

Runtime must provide a cleanup surface for generated voice artifacts by:

- `agent_id`
- `conversation_anchor_id`

Cleanup removes durable audio bytes and associated voice-artifact metadata. It
does not mutate committed text messages or conversation history.

### ReadArtifactBytes RPC

Carried over `RuntimeArtifactService` (per `Runtime<Domain>Service` naming
convention shared by `RuntimeAccountService`, `RuntimeAgentService`,
`RuntimeAiService`, `RuntimeAuthService`, etc.).

`ReadArtifactBytesRequest`:

- `artifact_id: string` (required)

`ReadArtifactBytesResponse`:

- `bytes: bytes` (required) — full artifact body
- `mime_type: string` (required) — RFC-6838 media type; must be present even if
  upstream provider didn't declare one (runtime fills `application/octet-stream`
  in that case but flags `mime_inferred: true`)
- `size_bytes: int64` (required) — artifact total size
- `mime_inferred: bool` (optional default false) — true if mime_type was
  runtime-inferred rather than provider-declared

### CleanupGeneratedVoiceArtifacts RPC

Carried over `RuntimeArtifactService`.

`CleanupGeneratedVoiceArtifactsRequest`:

- `agent_id: string` (optional selector)
- `conversation_anchor_id: string` (optional selector)

At least one selector is required. If both selectors are supplied, Runtime must
delete only generated voice artifacts that match both. The call is idempotent:
no matching generated voice artifacts returns `deleted_count=0`.

`CleanupGeneratedVoiceArtifactsResponse`:

- `deleted_count: int32`
- `deleted_artifact_ids: repeated string`

This RPC is restricted to generated assistant voice artifacts whose metadata
declares the `generated_agent_voice` retention scope. It must not delete
scenario image/video/music artifacts, uploaded user files, committed text
messages, or conversation history.

### Reason Codes

All reason codes are admitted in `tables/reason-codes.yaml` ARTIFACT family
under `source_rule: K-AGCORE-053`. Numeric values 600..604:

- `ARTIFACT_INVALID_INPUT` (600): caller request validation failed (empty
  artifact_id, etc.)
- `ARTIFACT_NOT_FOUND` (601): id not in runtime storage (gc / never created /
  cross-runtime)
- `ARTIFACT_TOO_LARGE` (602): artifact exists but exceeds inline retrieval
  limit (32 MiB hard ceiling for this admission; chunked retrieval requires
  future authority)
- `ARTIFACT_FORBIDDEN` (603): the protected caller is absent/revoked/expired or
  its account, app, release, session, generation, allowed use or artifact
  audience does not match
- `ARTIFACT_MIME_MISMATCH` (604): SDK-side check; client passed
  `expected_mime_prefix` and stored artifact mime_type does not start with
  the prefix (case-insensitive). Server never returns this reason; SDK
  raises it after receiving response.

Runtime handlers must return reason codes via
`grpcerr.WithReasonCode(codes.X, runtimev1.ReasonCode_ARTIFACT_*)`
per K-ERR-003 (ReasonCode in ErrorInfo details, not in status message
string).

### Size Cap

inline retrieval is hard-capped at 32 MiB. Larger artifacts return
`ARTIFACT_TOO_LARGE` even though the bytes exist. This contract does not
admit chunked retrieval; chunked retrieval requires a future authority update
before implementation.

### Caching

runtime is not required to cache; consumers should not assume cheap repeated
reads. Avatar consumer pattern: read once per voice_playback_requested,
decode to AudioBuffer, drop reference. Re-read same id only if previous
buffer was discarded.

### Trust Model

- `ReadArtifactBytes` requires the current Account-owned local-app operation
  decision and a matching durable artifact audience; app/session metadata,
  ordinary local gRPC and artifact-id possession are non-authorizing.
- Runtime revalidates the live process, account generation and durable
  local-app session before the artifact lookup, then matches account/principal/
  principal-lineage branch/session/generation/use/expiry before returning bytes.
- unbound historical records, direct local gRPC, wrong principal/account/principal-lineage/
  session, expired or revoked records and guessed ids fail closed.
- capability/grant admission is an additional gate. The admitted mapping is
  `data.scope.read` qualified by `runtime.artifacts`; the Account-owned
  coordinator revalidates the current local record, admitted permission decision and selector,
  process-bound session and artifact-owner policy on every read before the
  durable artifact audience is matched. Immutable provenance slots remain
  opaque and cannot become a positive package assertion before 0P/P.

## Backward Compatibility

artifact_id namespace exists today (emitted in `voice_playback_requested`
and `lipsync_frame_batch` per
[`tables/runtime-agent-event-projection.yaml`](tables/runtime-agent-event-projection.yaml)).
This contract is the first authoritative read-bytes SDK surface for it.
Existing `getScenarioArtifacts(jobId)` (S-RUNTIME-073 typed projection)
and `getVoiceAsset` remain admitted for their distinct use cases (job-typed
media result projection / voice asset library).

This is a hard cut: artifacts written before audience binding do not inherit
readability from their id, local-user ownership or earlier anonymous behavior.

## Drift Resistance

- ReasonCode ARTIFACT family must be admitted in three places synchronously
  (proto `common.proto` enum + `tables/reason-codes.yaml` + vNext SDK
  `sdks/typescript/types/reason-code.ts` ReasonCode const); spec validator enforces.
- emitter-side `Store.Put` must precede emit event; absence logs fatal.
- externally readable records must persist observed size, content SHA-256 and
  the complete account/principal/lineage/session/use/expiry audience; disk reads
  recheck payload size and hash.
- runtime handler must use `grpcerr.WithReasonCode`, not status.Error
  message string.
- SDK consumer surface must be class-member shape (`Runtime.artifacts.readBytes`),
  not singleton const export.
- inline size cap 32 MiB is hard; larger artifacts must fail-close
  `ARTIFACT_TOO_LARGE` (no silent truncation).

## Out of Scope (requires future authority)

- cross-device or cross-account artifact sharing and delegated audiences
- generic chunked retrieval for arbitrary artifact classes
- generic artifact metadata API (`describeArtifact`) beyond the generated voice
  metadata required above
- generic by-tag / by-source artifact discovery beyond generated voice cleanup
- artifact upload by id (`uploadArtifact` already exists with distinct semantics)
- platform-side `lipsync_frame_batch` deprecation

---

<!-- source: .nimi/spec/runtime/kernel/scenario-job-lifecycle.md -->

# ScenarioJob Lifecycle Contract

> Owner Domain: `K-JOB-*`

## K-JOB-001 适用 RPC

- 创建/执行：`SubmitScenarioJob`
- 查询/控制：`GetScenarioJob` `CancelScenarioJob` `SubscribeScenarioJobEvents` `GetScenarioArtifacts`

查询/控制 RPC 不走 connector 路径，走 job 元数据路径。

## K-JOB-002 ScenarioJob 状态机

ScenarioJob 状态枚举固定为 7 态（事实源：`tables/job-states.yaml`）：

| 状态 | terminal | 含义 |
|---|---|---|
| `SUBMITTED` | false | 已提交，等待调度 |
| `QUEUED` | false | 已入队，等待执行资源 |
| `RUNNING` | false | 执行中 |
| `COMPLETED` | true | 执行成功 |
| `FAILED` | true | 执行失败 |
| `CANCELED` | true | 被取消 |
| `TIMEOUT` | true | 执行超时 |

事件流在任一终态（`terminal=true`）后可正常关闭。

## K-JOB-003 凭据快照

`SubmitScenarioJob` 必须快照：

- `provider_type`
- `endpoint`
- `credential`

这三个字段对应 `K-KEYSRC-004` step 6 执行上下文三元组（`provider_type`/`endpoint`/`credential`）。快照在 job 创建时从执行上下文复制，后续轮询/取消/结果获取使用 job 快照，不依赖 connector 当前状态。

## K-JOB-004 凭据快照清理

job 到达终态后必须清理快照凭据（best-effort 内存清零 + 持久化删除）。

## K-JOB-005 connector 删除兼容

`DeleteConnector` 不得影响已提交 job 的可观测性与可控性；job 查询/取消/取结果能力以 job 元数据为准。

## K-JOB-006 快照凭据失效映射

- 若快照凭据被 provider 撤销：
  - `GetScenarioJob`：job 状态可标记为 `FAILED`，`reason_code=AI_PROVIDER_AUTH_FAILED`
  - `GetScenarioArtifacts`：返回 `FAILED_PRECONDITION` + `AI_PROVIDER_AUTH_FAILED`

## K-JOB-007 终态失败细节投影

`ScenarioJob` 终态失败信息必须分为两层：

- `reason_code` / `reason_detail`：稳定的短摘要，供通用轮询与 UI 列表展示
- `reason_metadata`：安全的结构化失败细节，供 SDK / Desktop / apps 继续投影到 `NimiError.details`

约束：

- `reason_metadata` 只允许包含 transport-safe、machine-readable 键值，不得泄漏凭据、header、token 或 provider 原始敏感 payload
- 当失败来源于已批准的 provider / local-runtime 启动类错误时，可包含 `provider_message`
- `CANCELED` / `COMPLETED` 终态不得保留历史失败元数据
- `SubscribeScenarioJobEvents` 与 `GetScenarioJob` 看到的 job 快照必须一致地携带该字段

## K-JOB-008 运行中进度投影

`ScenarioJob` 可在不改变状态机的前提下投影运行中进度：

- `progress_percent`：`0..100` 的运行进度百分比；未知时保持缺省/零值，不得伪造估算值
- `progress_current_step` / `progress_total_steps`：当 backend 能提供离散 step 进度时一并投影

约束：

- 进度字段只属于 job 快照，不引入新的 `ScenarioJobStatus`
- `SubscribeScenarioJobEvents` 可在 job 仍为 `RUNNING` 时重复发送 `RUNNING` 事件；消费者必须以最新 job 快照覆盖旧快照
- `GetScenarioJob` 与 `SubscribeScenarioJobEvents` 在同一时刻看到的进度字段必须一致
- 若 backend 无法提供可信进度，runtime 只返回状态，不得基于耗时或 UI 侧估算生成伪进度

---

<!-- source: .nimi/spec/runtime/kernel/daemon-lifecycle.md -->

# Daemon Lifecycle Contract

> Owner Domain: `K-DAEMON-*`

## K-DAEMON-001 Runtime 健康状态机

Runtime daemon 维护全局健康状态，枚举固定为：

| 状态 | 值 | 含义 |
|---|---|---|
| `STOPPED` | 1 | 未启动或已停止 |
| `STARTING` | 2 | 启动中 |
| `READY` | 3 | 就绪，可接受请求 |
| `DEGRADED` | 4 | 降级，部分功能不可用 |
| `STOPPING` | 5 | 停机中 |

迁移规则见 `tables/daemon-health-states.yaml`。

初始状态为 `STOPPED`。

## K-DAEMON-002 启动序列

Before any public or protected listener opens, Runtime validates the dedicated
`protected_local.db` ledger against its secure-store anti-rollback anchor,
generates the 32-byte CSPRNG boot epoch, and commits an anchored revocation of
all nonterminal prior-epoch protected state. Ledger unavailability,
corruption, rollback mismatch, endpoint ownership failure, or an unsupported
required OS primitive disables protected features fail-closed; it never
enables public-TCP or portable-session fallback.

In a production build the signed OS service manager definition must prove the
exact K-PLOCAL Runtime service principal, executable trust row, release digest,
and immutable production configuration before ledger or custody access. A
Desktop-spawned same-user process, command-line `serve`, user-session generic
keyring, environment-selected Realm/renderer/gRPC endpoint, user-writable
config, or test trust row is non-product and cannot open a production listener.
Desktop start/restart UX invokes the typed OS service-control gateway; it does
not choose or spawn the Runtime executable.

Daemon 启动固定为以下阶段：

1. **Service identity**：验证 service principal、signed service definition、connected-process platform code-signing identity、account partition 和 production/test isolation。
2. **Config**：仅从 signed service definition 与 signed release projection 加载 production 配置（`K-DAEMON-009`），校验地址与超时；env/argv/user-writable override 被拒绝。
3. **Protected state**：验证 service-owned custody/ledger/anchor 并提交 boot-epoch revocation。
4. **Servers**：并行启动 public gRPC/HTTP 与 protected local listeners。
5. **Engines**：若引擎 SUPERVISED 模式启用（`K-LENG-004`），创建 engine.Manager 并按配置启动 enabled 的引擎。引擎就绪后注入 endpoint 环境变量。启动失败不阻塞 daemon，标记 `DEGRADED`，并写入引擎 bootstrap 失败审计与 provider 不健康原因上下文。
6. **Ready**：状态从 `STARTING` 迁移到 `READY`，同步 gRPC health serving status。
7. **Probes**：启动资源采样（1s 周期，内存）与 AI Provider 健康探测（`K-PROV-003`）。

## K-DAEMON-003 优雅停机

收到 shutdown 信号后：

1. 状态迁移到 `STOPPING`，同步 gRPC health serving status。
2. daemon-owned shutdown controller 冻结一个统一 deadline，并主动取消活跃 gRPC RPC/streams（规则见 `K-STREAM-010` 与 `K-STREAM-008`）。
3. 短暂 drain 窗口内允许已收到取消信号的 handler 自行退出。
4. 停止 supervised 引擎（`engineMgr.StopAll()`，`K-LENG-004`）。
5. 停止资源采样与 AI Provider 探测。
6. 带超时关闭 HTTP server（默认 10s，通过 `K-DAEMON-009` 配置）。
7. 带超时关闭 gRPC server（GracefulStop；同一 deadline 到期后 ForceStop）。
8. 状态迁移到 `STOPPED`。

若 gRPC 在 deadline 内未自然排空，但 runtime 已执行 ForceStop 并在 deadline 内完成进程级退出，则该 shutdown 仍视为**受控完成**；必须写出带 `forced=true` 的 lifecycle audit 和诊断日志，不得把这一路径当成伪成功或静默吞掉。

停机期间只读方法允许通过 lifecycle 拦截器（`K-DAEMON-005`）。

**跨状态机联动（K-DAEMON-003）**：daemon 进入 `STOPPING` 时对 in-flight 任务的影响：

| 子系统状态机 | STOPPING 行为 | 引用 |
|---|---|---|
| 活跃 ScenarioJob（K-JOB-001） | lifecycle 拦截器拒绝新请求（`UNAVAILABLE`）；已建立的 job 事件流可被 shutdown controller 以 `CANCELLED` 预empt，后台 job 由进程/engine shutdown 继续兜底 | K-DAEMON-003 step 2 |
| 活跃 StreamScenario | 活跃执行流可被 shutdown controller 直接 `CANCELLED`，不得伪造完成态；若 handler 不退出，deadline 到期后 ForceStop | K-DAEMON-003 step 2 |
| 长生命周期订阅流（K-STREAM-010） | server 以 `CANCELLED` 关闭所有活跃订阅流，不得继续占住 `GracefulStop` | K-STREAM-010 |
| Supervised 引擎（K-LENG-004） | 向所有引擎进程发送 SIGTERM，超时后 SIGKILL。引擎停止在 gRPC/HTTP 关闭前执行 | K-DAEMON-003 step 4 |
| Provider 探测（K-PROV-003） | 停止探测；`StreamScenario` 旁路的 authz 范围豁免不适用于健康探测循环 | K-DAEMON-003 step 5, K-KEYSRC-004 |
| Session 内存 map（K-AUTHSVC-012） | 进程退出后丢失，所有 session 失效 | K-AUTHSVC-012 |

**设计决策**：bounded shutdown 以“可靠退出”优先于“最大化优雅排空”。Runtime 允许在 `STOPPING` 时主动取消活跃 stream/RPC，以避免 daemon 因长生命周期订阅、health watch 或执行流卡死。若未来引入服务端排空协议，必须仍保留 force-stop bounded exit 作为最终兜底。

## K-DAEMON-005 gRPC 拦截器链

For protected transports, immutable `protected-origin` derivation executes
before version/protocol parsing, authn, authz, business request parsing, token
access, or network I/O. It binds the K-PLOCAL-003..005 verified
connection/process facts and rejects transport/role mismatch. Public TCP gets
an explicit non-protected origin and cannot supply protected metadata.

gRPC 请求经过 9 层有序拦截器，unary 与 stream 分别注册：

| 顺序 | 名称 | Unary | Stream | 职责 |
|---|---|---|---|---|
| 1 | protected-origin | 是 | 是 | 在解析 protocol/auth metadata 前从连接派生 immutable transport/process origin；public TCP 只能得到 non-protected origin |
| 2 | version | 是 | 是 | 版本协商：向 response header 注入 `x-nimi-runtime-version` |
| 3 | lifecycle | 是 | 是 | 健康状态门控：`STOPPING`/`STOPPED` 时拒绝非只读请求（`UNAVAILABLE`） |
| 4 | activity | 是 | 是 | 活跃 RPC 跟踪：记录方法分类、最近活动时间、shutdown disposition |
| 5 | protocol | 是 | 是（仅解析） | 信封解析、幂等性检查（unary only，`K-DAEMON-006`）、metadata 提取 |
| 6 | authn | 是 | 是 | 认证校验：解析并校验 metadata `authorization`，投影调用方身份 |
| 7 | authz | 是 | 是（仅 ExportAuditEvents） | 保护能力校验：通过 grant service 验证 token 有效性 |
| 8 | credential-scrub | 是 | 是 | 擦除进入 handler context 的敏感 credential metadata，避免下游日志/审计链路回显原始凭据 |
| 9 | audit | 是 | 是 | 审计记录：请求/响应写入审计日志，更新使用量指标 |

说明：

- `StreamScenario` 的授权范围豁免由 `K-KEYSRC-004` 在请求评估链中单独定义，不归入本表的 stream authz 适用面；本表中 stream authz 拦截器仅对 `ExportAuditEvents` 生效。
- protected-origin interceptor 只消费 OS/transport 层事实，不解析或相信 request metadata；activity interceptor 负责 shutdown/drain 期的活跃 RPC 跟踪，不替代 lifecycle gate。
- credential-scrub interceptor 发生在 authz 之后、audit 之前；它不移除 authn/authz 所需凭据，只防止下游消费到原始 credential metadata。

协议信封 metadata 的单字段值必须不超过 `4096` bytes。超限时 protocol interceptor 必须以 `PROTOCOL_ENVELOPE_INVALID` fail-close，避免在现有 gRPC/HTTP header 总预算（64 KiB）内被单个异常大字段挤占或污染日志链路。

## K-DAEMON-006 幂等性契约

- **适用范围**：仅 unary RPC，流式 RPC 不做幂等性检查。
- **去重键**：`AppID + IdempotencyKey`（从 gRPC metadata 提取）。
- **TTL**：24 小时，过期后同一键可重新执行。
- **命中行为**：返回缓存的响应，不重新执行。
- **缺失 IdempotencyKey**：不做去重，正常执行。
- **存储介质**：进程内内存 map。不跨重启持久化（重启后相同 key 可重新执行）。
- **容量上限**：默认 10,000 条，超限时按 LRU 淘汰最久未访问的条目。

> **参数选取依据**：24h TTL 覆盖跨时区用户的同一操作重试窗口（最远场景：用户跨日期线后重试前一天的操作）。10,000 条容量覆盖单日高频用户的全部 unary RPC 调用量（估算：每次 AI 请求 ~3 个 unary RPC，单用户日均 AI 请求 < 1,000 次，10k 留 3x 余量）。每条记录约 200 bytes（request hash + response snapshot），总计 ~2 MB，在桌面端可忽略。

## K-DAEMON-007 调度器并发模型

AI 执行路径使用双层信号量控制并发：

- **全局并发上限**：默认 8（可配置）。
- **每 App 并发上限**：默认 2（可配置）。
- **获取顺序**：先获取全局信号量，再获取 per-app 信号量。释放顺序相反。
- **饥饿检测**：等待时间超过阈值（默认 30s）时，`AcquireResult.Starved=true`。
- **空 AppID 处理**：归入 `_default` 键。

> **参数选取依据**：全局并发上限 8 ≈ 典型桌面端 CPU 核数（4-8 核），避免 AI 推理独占全部计算资源。Per-app 上限 2 保证至少 4 个 app 可同时发起推理（8 / 2 = 4），防止单个 app 独占全部 slot。饥饿检测 30s 仍早于 StreamScenario 的首包超时 60s 和总超时 120s，确保在流式请求进入 provider timeout 前有机会检测到调度饥饿。

## K-DAEMON-008 AI 超时层次

各 AI 操作的默认超时值（事实源：`tables/ai-timeout-defaults.yaml`）：

| 操作 | 默认超时 |
|---|---|
| ExecuteScenario(TEXT_GENERATE) | 30s |
| StreamScenario（首包） | 60s |
| StreamScenario（总） | 120s |
| ExecuteScenario(TEXT_EMBED) | 20s |
| SubmitScenarioJob(image) | 120s |
| SubmitScenarioJob(video) | 300s |
| StreamScenario(SPEECH_SYNTHESIZE) | 45s |
| SubmitScenarioJob(stt) | 90s |

超时可通过请求级 `timeout_ms` 覆盖（但不得超过服务端上限）。

## K-DAEMON-009 配置解析

Production configuration has two disjoint classes:

1. **Boot security configuration** — service principal, service definition,
   protected/public listener identity, installer-owned active release identity, Realm account
   endpoints, custody locations, and test/production posture come only from the
   signed OS service definition and signed Runtime release projection. They are
   immutable at runtime.
2. **Mutable product configuration** — admitted provider/model/local-engine and
   user preference fields live in service-principal-owned state and may change
   only through typed protected Desktop control after authorization. The
   service validates the closed `tables/config-schema.yaml` row before commit.

Production ignores and rejects `NIMI_RUNTIME_*`, argv-selected endpoints,
user-writable config files, `~/.nimi/runtime/config.json`, app/renderer
metadata, and unknown fields as configuration authority. The pre-release
hardcut performs no legacy import. Separately signed non-product binaries may
accept explicit test harness configuration only with synthetic custody and
non-product endpoints; those runs cannot produce product evidence.

校验规则：
- 地址必须为合法 `host:port` 格式。
- `ShutdownTimeout > 0`。

The physical service-owned path is OS-profile-specific and never returned to
Desktop/apps. Config reads return a redacted typed projection; config writes
commit through the Runtime service and cannot replace boot security fields.
Unknown fields fail closed.

**Typed protected config mutation response**：

- `CONFIG_RESTART_REQUIRED`：至少一个 `restart` 列字段发生了变更。
- `CONFIG_APPLIED`：仅 `hot` 列字段发生变更，或无实质变更。

Desktop may present `CONFIG_RESTART_REQUIRED` and request the typed service
`restart` operation. It never calls stop, writes a document, or selects a
binary/config path.

`providers.*`、`engines.llama.*`、`engines.media.*` 变更属于 restart 范畴，必须返回 `CONFIG_RESTART_REQUIRED`。legacy `engines.localai.*`、`engines.nexa.*`、`engines.nimi_media.*` 命中时必须 reject。

## K-DAEMON-010 HTTP 健康端点

Daemon 暴露以下 HTTP 端点：

| 路径 | 方法 | 语义 |
|---|---|---|
| `/livez` | GET | 进程存活：始终返回 200 |
| `/readyz` | GET | 就绪检查：`READY` 时 200，否则 503 |
| `/healthz` | GET | 综合健康：同 `/readyz` |
| `/v1/runtime/health` | GET | 完整健康快照（JSON，字段同 `GetRuntimeHealthResponse`） |

## K-DAEMON-011 版本 Metadata 交换协议

Runtime daemon 必须通过 gRPC server metadata 暴露版本信息，供 SDK 进行版本兼容判定（`S-TRANSPORT-005`）。

**协议**：

- gRPC server 在每个 RPC 的 response header metadata 中携带 `x-nimi-runtime-version`，值为 semver 格式（如 `0.1.0`）。
- 版本值在 daemon 启动时确定，整个进程生命周期内不变。
- SDK 从首次成功 RPC 的 response metadata 中提取版本，缓存后用于后续兼容判定。
- 若 metadata 缺失（旧版 Runtime 或非 gRPC 传输），SDK 按 `S-TRANSPORT-005` 的 best-effort 策略处理。

**与 Desktop 的关系**：

- Desktop 通过 `runtime_bridge_status` 返回的 `daemonVersion` 字段获取版本（`D-IPC-002`/`D-IPC-014`），不依赖本规则。
- 本规则面向 `node-grpc` 传输的独立 SDK 消费者。两条路径语义等价，传输手段不同。

## K-DAEMON-012 Local App Restart Invalidation

The fixed OS service preserves the service-owned local-app principal, local
record, grant and audit stores across a normal Runtime restart. Every restart
advances the boot epoch and invalidates all outstanding local-app launch
leases, process bindings, sessions, challenges and presence proofs before any
protected listener becomes ready. Durable grants remain records, but no grant
authorizes work until the caller opens a new session for the new boot epoch and
the per-operation coordinator re-resolves the current authority class and, for
an admitted user permission, the current owner decision revision.

Runtime restart must therefore support conversation continuity owned by
RuntimeAgent/Cognition while refusing reuse of the pre-restart process carrier.
State corruption, rollback mismatch, account-partition mismatch, service-owned
root mismatch or inability to commit epoch invalidation makes protected local
app access unavailable; no direct daemon, environment-selected root, portable
session, app-id lookup or old process channel may recover it.

---

<!-- source: .nimi/spec/runtime/kernel/cli-onboarding-contract.md -->

# Runtime CLI Onboarding Contract

> Owner Domain: `K-CLI-*`

## K-CLI-001 Public First-Run Command Set

面向首次使用的 runtime public CLI surface 必须稳定提供 `serve`、`doctor`、`version`、`run`、`model`、`provider`。

## K-CLI-002 Top-Level Usage Grouping

顶层 `nimi` usage 必须按 `Quick Start`、`Model Management`、`Cloud Setup`、`Runtime Ops`、`Advanced/Admin` 分组展示；首次使用路径不得被 infra/debug 子命令淹没。

## K-CLI-003 Run Happy Path Shape

首次使用文本生成命令必须是 prompt-first 形态，并收敛到以下 high-level targeting：

- bare `nimi run "<prompt>"` / `nimi run "<prompt>" --local`：本地默认文本模型
- `nimi run "<prompt>" --model <local-model-id>`：本地显式模型
- `nimi run "<prompt>" --provider <provider>`：provider 默认文本模型
- `nimi run "<prompt>" --provider <provider> --model <model>`：provider 显式模型
- `nimi run "<prompt>" --cloud`：default cloud provider 的默认文本模型

`--local` 与 `--cloud` 互斥；`--provider` 表示 cloud targeting，且不得与 `--local` 联用；`--cloud --model <value>` 不得成为 high-level public surface。默认行为为直接流式输出文本，`--json` 才返回结构化结果。

## K-CLI-004 Daemon-Down Error Contract

当 runtime daemon 不可达时，`nimi run` 与 `nimi provider test` 必须 fail-close，并返回单一步骤的可执行提示，不得暴露原始 gRPC/dial 细节到 public surface。

## K-CLI-005 Local Model Install Guidance

当 bare `nimi run`、`--local` 或 local `--model <local-model-id>` 解析出的本地目标模型缺失时，`nimi run` 必须提示安装；`--yes` 自动确认，`--no-install` 必须返回直接可执行的 `nimi model pull` 下一步，不得静默跳过。

## K-CLI-006 Onboarding Model Namespace

high-level onboarding surface 中，`model` 字段只表示具体模型，不承担 route/provider alias 语义；`provider` 出现即表示 cloud。high-level `--model` 允许 slash-bearing local model id，但不得把 fully-qualified remote model id 暴露为 public happy path；任意 fully-qualified remote model id 仅保留在低层 advanced surface，不得在 onboarding surface 回流 provider prefix 推断列表。

## K-CLI-007 Provider-First Cloud Setup

cloud 首次使用必须基于 machine-scoped provider credentials；public cloud setup surface 为 `nimi provider list|set|unset|test`，且 `nimi run` 必须支持 provider-first one-shot 入口（`--provider` / `--provider + --model`）与 machine-default cloud 入口（`--cloud`）。当 cloud credential 缺失且 provider 可确定时，interactive CLI 必须允许用户粘贴 API key、立即写入 canonical config，并继续完成同一条 run 命令；不得要求 account login 才能完成 basic cloud generation。

## K-CLI-008 Doctor Minimum Report

`nimi doctor` 至少报告 binary version、config path、daemon health、local engine health、configured providers、installed models，以及当前工作目录下的 optional SDK detection。

## K-CLI-009 Author App Scaffold Contract

app author scaffolding 不属于 `nimi` runtime public onboarding surface。Author-facing app scaffolding is governed by Platform `P-SCAF-*` and its admitted `nimi-app create|doctor|update` command family.

Runtime CLI does not own scaffold templates, template names, generated build profiles, submitted manifests, pack / publish workflow, public admission, or generated app auth helper shape.

## K-CLI-009a Runtime / Author Tooling Boundary

`nimi` public CLI 不承载 author-side scaffolding、build、dev、doctor、pack 或 publish flow。App 作者入口必须收敛到 `pnpm dlx @nimiplatform/app-tools nimi-app create|doctor|update` 与 Platform-governed scaffold semantics.

Runtime may point developers to the app-authoring tooling, but it must not own scaffold templates, build profiles, pack, publish, admission, local audit semantics, or scaffold doctor/update semantics.

## K-CLI-010 Version Contract

`nimi version` 必须输出 `nimi version`、`go version`、`os/arch` 与 `config path`，用于安装面和问题排查。

## K-CLI-011 Foreground Serve Contract

`nimi serve` 是 canonical foreground runtime command；它保持前台运行、直接输出日志，不得隐式 daemonize。

## K-CLI-012 Background Runtime Management Surface

background runtime management surface 必须稳定提供 `nimi start`、`nimi stop`、`nimi status`、`nimi logs`；`status` 表示进程/实例状态，`health` 保持详细运行时健康视图。

## K-CLI-013 Background Start Readiness Gate

`nimi start` 只有在 child process 已启动且 runtime health probe 可达后才可返回成功；探针返回 degraded 仍可算成功，但未通过 reachability 检查前不得报告成功。

## K-CLI-014 Status Reachability Contract

`nimi status` 不得只读本地 state files；它必须同时验证 process liveness 与 runtime reachability，并以不同退出码区分 stopped 与 probe failed。

## K-CLI-015 Stale Daemon State Cleanup

background runtime state files（如 `daemon.pid`、`daemon.json` 与 stale lock state）必须 fail-close 清理；若 state 与 live process 不一致，CLI 必须优先 live process truth 并移除陈旧 state。
