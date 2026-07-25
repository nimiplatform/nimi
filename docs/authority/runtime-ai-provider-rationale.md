# Runtime AI Provider - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/runtime/ai-provider.authority.yaml`。

---

<!-- source: .nimi/spec/runtime/kernel/ai-profile-execution-contract.md -->

# AI Profile Execution Contract

> Owner Domain: `K-AIEXEC-*`

## K-AIEXEC-000 Runtime Target Identity v2 Hard Cut

`K-RTARGET-*` is the active target-identity authority. AIProfile execution
persists v2 durable target refs only. Any older text in this file that admits
`localModelId`, `goRuntime*`, selected binding evidence, raw `model_id`, or
`connector_id + model_id` as durable execution or memory binding identity is
retired.

## Scope

定义 runtime 侧对 `AIProfile`（D-AIPC-002）的 probe、materialization、execution snapshot 与 resource scheduling 的 canonical rules。本契约桥接 desktop portable `AIProfile` 与现有 `ResolveProfile`/`ApplyProfile` 本地执行管道（K-LOCAL-013~015, K-LOCAL-014a）。

## K-AIEXEC-001 — AIProfile Runtime-Facing Descriptor Boundary

`AIProfile` 是 portable 配置包（D-AIPC-002），不直接等于 Runtime install /
materialization facts, local asset records, local route bindings, or legacy
`LocalProfileDescriptor` entry lists. Runtime-facing descriptor is the admitted
validation input boundary between portable profile intent and Runtime
prepare/readiness/materialization.

Descriptor formation and validation rules:

- SDK/host forms a contract-bound descriptor from `AIProfile` capability
  slices and app/module/feature requirement declarations (`S-AICONF-004`,
  `S-AICONF-010`).
- Runtime must independently validate the descriptor schema, source profile
  digest, capability slices, authored `execution.backend`, authored
  `model.family`, asset/source bindings, ordered companion occurrences,
  connector refs, params, and requirement mapping before prepare or apply
  eligibility can succeed.
- Runtime may translate a validated descriptor into existing internal
  `ResolveProfile` / `ApplyProfile` / materializer inputs, but that translation
  is runtime-private and cannot become AIProfile or AIConfig payload.
- Legacy `LocalProfileDescriptor` remains an internal/runtime execution adapter
  shape only where reused by K-LOCAL-013~015. It is superseded as the public
  AIProfile projection authority by the descriptor boundary in this rule.
- Descriptor fields are validation inputs, not materialized execution facts.
  Runtime outputs readiness, selected-source evidence, materialization evidence,
  workflow binding identity, and execution facts separately.

边界固定为：

| 职责 | Owner |
| --- | --- |
| `AIProfile` portable schema 定义与验证 | Desktop Kernel (D-AIPC-002) |
| app/module/feature requirement declarations and descriptor request formation | SDK (`S-AICONF-004`, `S-AICONF-010`) |
| descriptor validation, prepare, readiness, materialization, source evidence, backend/family validation | Runtime |
| internal `LocalProfileDescriptor` / execution adapter translation | Runtime (K-LOCAL-013~015) |
| device profile collection | Runtime (K-DEV-001~009) |
| local asset resolution & health | Runtime (K-LOCAL-014a) |

Descriptor MUST NOT contain local file paths, endpoint URLs, RuntimeRouteBinding
or selectedBindings evidence, `localModelId`, `goRuntime*`, selected source
records, install evidence, backend package/Python/Torch/CUDA evidence,
materialization records, workflow binding ids, provider health, scheduler
state, or connector secret material. Runtime must reject descriptors containing
such fields with a typed forbidden-host-local-field failure.

## K-AIEXEC-002 — Probe Contract

Runtime 对 `AIProfile` / descriptor 相关 probe 请求的响应分为三层，对应
D-AIPC-012 probe taxonomy：

### Static schema probe

- SDK/Desktop may perform portable schema checks before descriptor formation.
- Runtime must still validate the runtime-facing descriptor schema and reject
  forbidden host-local/runtime evidence. A prior SDK static probe is advisory
  and cannot replace Runtime descriptor validation.

### Runtime availability probe

- 消费 `runtime.route.checkHealth(...)` 与 `runtime.route.describe(...)` 的现有 RPC。
- 检查所需 provider / engine / route 是否在线可用。
- runtime 不新增专用 probe RPC；availability probe 复用现有 route health surface。
- availability probe is diagnostic/evidence only. It may not replace explicit
  profile prepare or permit apply to write required unresolved slices.

### Resource feasibility probe

- 消费 `CollectDeviceProfile`（K-DEV-001）获取当前设备资源状态。
- 消费 `ResolveProfile`（K-LOCAL-014a）获取执行计划与 warnings。
- 消费 runtime scheduler `Peek`（K-SCHED-002）获取动态并发 / scheduling judgement。
- `ResolveProfile` 负责 local dependency / execution plan feasibility；`Peek` 负责 scheduling preflight。两者不可互相替代。
- 当 caller 需要 scope-level feasibility 时，消费 K-SCHED-002 的 aggregate judgement；当 caller 需要 submit-specific execution truth 时，消费对应 target judgement。
- resource feasibility consumes the validated descriptor and any existing
  readiness projection. It must not infer backend/model family from resolver
  output when the descriptor declares authored `execution.backend` /
  `model.family`; mismatch fails closed unless a future profile-authored
  fallback policy is admitted.

## K-AIEXEC-003 — Execution Snapshot Contract

runtime 侧执行快照的最小要求：

- 每次 `ExecuteScenario` / `StreamScenario` / `SubmitScenarioJob` 调用时，runtime 必须在 execution context 中固化以下 evidence：
  - caller's AIConfig compact logical refs and the Runtime-resolved
    materialization / connector / local route evidence derived from them
  - resolved effective capability（runtime 侧 resolve 结果）
  - descriptor/readiness/materialization refs consumed for the selected
    profile/config slice
  - device resource snapshot（调用时的 scheduler occupancy、可选 device profile summary）
  - scheduling preflight judgement（如果 caller 在 `Acquire` 前执行了 `Peek`（K-SCHED-002），其**submit-specific execution target judgement** 结果作为 optional evidence 附带）
- 固化后的 evidence 不可被后续 config 变更覆盖。
- evidence 写入 audit trail（K-AUDIT-001）。

约束：

- 写入 execution snapshot 的 `schedulingJudgement` 必须对应当前 submit 即将触发的 capability / target；它不是 scope 级 aggregate probe 的替身。
- 若 caller 同时持有 scope aggregate judgement 与 submit-target judgement，execution snapshot 只能记录 submit-target judgement。
- 若 caller 只有 scope aggregate judgement 而没有 submit-target judgement，则 `schedulingJudgement` 必须为 null；不允许把 scope aggregate judgement 误写为 execution evidence。

与 desktop `AISnapshot`（D-AIPC-004）的关系：

- desktop `AISnapshot.runtimeEvidence` 消费 runtime execution evidence。
- desktop 通过 `ConversationExecutionSnapshot`（D-LLM-019）或等效 snapshot slice 记录 app-facing execution evidence。
- scheduling preflight judgement 通过 `AISnapshot.runtimeEvidence.schedulingJudgement` 传递到 desktop（D-AIPC-004），且该值始终对应 submit-specific execution target。
- runtime 不感知 desktop 的 `AISnapshot` 或 `AIConfig` schema；runtime 只提供 execution evidence 数据。
- execution may read AIConfig snapshot plus Runtime materialization evidence,
  but neither probe nor execution may replace explicit descriptor prepare for a
  profile-owned workflow.

## K-AIEXEC-004 — Scheduling Boundary

当前 runtime scheduler 的 semaphore baseline 能力固定为：

- global semaphore acquire/release
- per-app semaphore acquire/release
- queue wait duration observation
- starvation detection

Five-state scheduling judgement 由独立契约 `scheduling-contract.md`（K-SCHED-001~007）定义，包括：

- non-blocking `Peek` preflight（K-SCHED-002）
- occupancy telemetry（K-SCHED-003）
- typed denial rules（K-SCHED-004）
- risk state heuristics（K-SCHED-005）
- capability / resource hint semantics（K-SCHED-007）

`Peek` 是 advisory preflight，`Acquire` 仍是 authoritative slot acquisition（K-SCHED-006）。Desktop/SDK 通过 scope aggregate feasibility surface 与 submit-target scheduling surface 分别消费 scheduling judgement（D-AIPC-012, S-AICONF-001）。

## K-AIEXEC-005 — No Global Active Profile In Runtime

- runtime 不维护"当前全局生效 AI profile"概念。
- `ResolveProfile` / `ApplyProfile` 是 per-call 操作，不建立持久 runtime-global profile binding。
- 多个 scope 可并发执行不同 profile 的 resolve/apply，runtime 不做跨 scope 联动。
- 本规则约束的是通用 profile resolve/apply 层。`RuntimeAgentService` 拥有的
  Runtime Agent AI Config（K-AGCORE-144~150）是 agent 域的 scoped
  committed 状态，不构成也不得被解释为 runtime-global active profile；两者
  不得互相替代。

## K-AIEXEC-006 — Memory Embedding Binding Resolution Boundary

Runtime Local Agent memory embedding 的 committed `text.embed` intent 由
Runtime Agent AI Config 持有；runtime 负责把该 intent 解析为真正的
execution/bank truth。

固定规则：

- runtime 必须把 Runtime Agent AI Config `text.embed` intent 解析成
  runtime-owned resolved embedding profile 或 fail-close result
- `cloud` binding 的 legality 继续消费 connector / key-source authority：
  admitted shape 必须是 v2 cloud target ref，至少包含
  `connector_id + remote_model_catalog_id + provider_model_id`
- `local` binding 的 legality 继续消费 runtime local/model authority：
  admitted shape 必须是可由 runtime authoritative local inventory 解析的 typed
  local embedding target reference
- Desktop/SDK 不得自行计算 resolved embedding profile、profile identity、或
  canonical bank binding truth；它们只能通过 Runtime/SDK ai-config mutation
  提交 intent，并消费 runtime projection
- 若 `text.embed` intent 不能解析到 admitted embedding-capable execution path，
  runtime 必须返回 fail-close result，不得静默回退到别的 connector、provider、
  或本地默认 embedding target

## K-AIEXEC-007 — First-Run Baseline Execution Evidence

Runtime owns the executable proof behind product first-run
`executionEvidenceRef`. The ref is durable execution evidence for the selected
local first-run baseline, not a Desktop snapshot id by itself and not a route
health or probe result.

`executionEvidenceRef` is valid only when it resolves to a Runtime audit /
execution evidence record that:

- binds the selected first-run local factory `AIProfile` ref, install level,
  `runtimeBaselineRef`, `dataRootRef`, and local execution target evidence
- proves execution against the selected local baseline capability set; Minimal
  baseline must include local chat/text plus basic local STT and TTS capability
  proof, and Recommended must include every additional required local baseline
  capability selected by the confirmed plan
- records the submit-specific execution target scheduling judgement when one
  was evaluated, and never substitutes a scope aggregate judgement for
  submit-time evidence
- records terminal success/failure, timestamps, verifier identity, and audit
  evidence sequence

The selected local first-run baseline proof must execute through the admitted
Runtime local execution path and consume the previously verified
`runtimeBaselineRef`. Cloud API, cloud-only, cloud-first, hybrid, video,
connector setup, app-specific packs, synthetic snapshots, warmup-only checks,
or route probes cannot satisfy `executionEvidenceRef`.

Desktop `AISnapshot` may reference this Runtime execution evidence, but the
Desktop snapshot cannot replace the Runtime evidence record as the verifier for
product ready admission.

## K-AIEXEC-008 — Descriptor Field Contract

Runtime validates the descriptor shape recorded in
`tables/profile-runtime-descriptor-schema.yaml`.

Required descriptor fields:

| Field | Meaning |
|---|---|
| `schema_version` | Runtime-supported descriptor schema version. |
| `descriptor_id` | Stable id for this projected descriptor instance. |
| `profile_ref` | Portable source profile id/version/revision. |
| `source_profile_digest` | Digest of canonical source profile bytes. |
| `projection_origin` | SDK/host projection component and timestamp. |
| `requirement_refs[]` | App/module/feature requirement ids from S-AICONF-010. |
| `capability_slices[]` | Profile-local slices with capability, mode, contract state, readiness policy, params, editable fields. |
| `asset_bindings[]` | Local source/manual/component/companion requirements. |

Local slice fields:

- `execution.backend` and `model.family` are authored validation constraints,
  not resolver outputs or hints.
- `backend_profile`, `host_requirements`, and `environment_requirements` are
  descriptor validation inputs owned by Runtime registries.
- `fallback_policy` is not admitted in v1. Backend/family mismatch must fail
  closed.

Cloud connector slice fields:

- provider, provider capability class, provider model id, non-secret connector
  selector, credential policy, params, readiness policy.
- connector readiness consumes K-CONN/K-KEYSRC custody and legality; descriptor
  and AIConfig never contain raw credential material.

Runtime outputs:

- per-slice validation result;
- source readiness and selected-source evidence;
- profile prepare job state;
- per-slice readiness projection;
- per-requirement apply eligibility;
- materialization/cache/workflow binding records;
- execution evidence.

These outputs are not descriptor fields and must not be persisted into
AIProfile or AIConfig.

## K-AIEXEC-009 — Profile Prepare, Readiness, And Apply Eligibility

Runtime owns whole-profile prepare and per-slice readiness projection for
descriptor-backed profile workflows.

`MUST`:

- prepare validates the complete descriptor before materialization.
- readiness is computed per profile slice and per app/module/feature
  requirement, preserving required vs optional semantics from S-AICONF-010.
- apply eligibility can be `ready`, `setup_required_no_live_config`,
  `unsupported_no_live_config`, `failed_no_live_config`, or
  `optional_omitted`. Required non-ready slices block AIConfig write. Optional
  non-ready slices may be omitted without placeholder config.
- existing valid AIConfig must be preserved until a successful apply replaces
  it.
- prepare/readiness must reuse Runtime local environment materializers
  (`K-LENG-028`, `K-LENV-MAT-*`) and activation gates (`K-LENV-ACT-*`), not
  create a second downloader, Python manager, connector custody path, or source
  selector.

`MUST NOT`:

- probe, route health, endpoint reachability, file existence, transfer
  completion, previous health, or execution success may substitute for explicit
  prepare/readiness.
- required unresolved slices must not write live AIConfig.
- unsupported/proposed future slices (including diffusers/video) must not be
  treated as native image with extra params.

## K-AIEXEC-010 — Failure Taxonomy And Identity Split

Runtime failure classes for profile workflow binding are closed to the following
axes:

| Class | Owner | Meaning |
|---|---|---|
| `asset_health` | Runtime local asset | Reusable local asset existence, manifest, integrity, and registration. |
| `source_readiness` | Runtime source/materializer | Download/manual/HF access/integrity readiness for a binding. |
| `profile_validation` | Runtime descriptor validator | Descriptor/slice/schema/backend/family/params validation. |
| `workflow_readiness` | Runtime workflow prepare | Required assets, components, companions, params, backend/family, and env ready for a slice. |
| `environment_readiness` | Runtime local environment | Package/materializer/Python/Torch/CUDA/accelerator state. |
| `connector_readiness` | Runtime connector | Cloud provider/model/credential readiness. |
| `apply_eligibility` | Runtime projection from SDK requirement | Whether required consumer slices can write live AIConfig. |
| `scheduling_failure` | Runtime scheduler | Queue/resource/concurrency denial. |
| `execution_failure` | Runtime execution | Per-run backend/provider failure after readiness. |

Identity split:

- reusable asset identity (`local_asset_id` / `asset_id`) is not workflow
  binding identity;
- prepared asset identity and selected-source evidence are Runtime-owned;
- profile slice identity (`slice_id`) and companion occurrence identity are
  portable profile intent;
- AIConfig slice identity is consumer-scoped live config;
- workflow binding id and materialization cache key are Runtime-owned and must
  not enter AIProfile/AIConfig.

Workflow readiness failure, missing required companion, unsupported
backend/family, environment failure, connector failure, scheduling denial, or
execution failure must not poison reusable asset health unless the reusable
asset itself fails asset-health validation.

## K-AIEXEC-011 — Materialization Cache Key

Runtime materialization/cache identity for profile workflows must include every
dimension that can change executable semantics:

- profile ref and source digest;
- requirement id and `slice_id`;
- authored `execution.backend` and `model.family`;
- host tuple and relevant runtime support registry versions;
- main prepared asset id;
- required component prepared ids;
- ordered companion occurrences, including occurrence id/order/role/prepared
  asset id/weight/options;
- params digest;
- environment digest for backend/package/Python/Torch/CUDA/accelerator state.

A cache key keyed only by main asset id is forbidden for descriptor-backed
workflows. Stored workflow reuse and active runtime selection are distinct:
multiple workflow bindings may reuse one healthy asset, while scheduler /
activation controls decide concurrent execution or fail closed.

## K-AIEXEC-012 — Future Local Media Workflow Contract Shapes

Runtime admits first-class workflow contract shapes for future diffusers image
and local video even when current runtime support state is proposed or
unsupported. The shape is recorded in `tables/profile-workflow-contracts.yaml`.

Rules:

- diffusers image uses `execution.backend=diffusers`, model lineage such as
  `sdxl`, `backend_class=python_pipeline`, and explicit components such as
  tokenizer/text encoder/scheduler/VAE plus Python/Torch/diffusers environment
  requirements.
- video uses `capability=video.generate`, video-specific backend/model-family,
  explicit video components such as motion module/decoder/scheduler, and
  params including frame count, fps, duration, dimensions, guidance/steps/seed.
- Unsupported/proposed runtime support state must project setup-required /
  unsupported no-live-config for required slices.
- Video must not be modeled as `image.generate` with an extra duration field.
- `media.diffusers`, backend_class, and backend_family remain runtime-private
  support/readiness detail unless explicitly mapped by Runtime validation
  registry; they are not public engine targets.

## Fact Sources

- `local-profile-application-contract.md` — K-LOCAL-013~015, K-LOCAL-014a (`ResolveProfile`, `ApplyProfile`)
- `device-profile-contract.md` — K-DEV-001~009 (device profile collection)
- `model-service-contract.md` — K-MODEL-001~008 (model descriptor, health check)
- `scheduling-contract.md` — K-SCHED-001~007 (five-state scheduling judgement)
- `key-source-routing.md` — K-KEYSRC-001~011 (remote binding legality)
- `connector-contract.md` — K-CONN-001~017 (connector custody and legality)
- `.nimi/spec/desktop/ai-consumption.authority.yaml` — D-AIPC-001~012 (desktop AI config authority)
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — P-AISC-001~005 (AIScopeRef)

---

<!-- source: .nimi/spec/runtime/kernel/connector-contract.md -->

# Runtime Connector Contract

> Owner Domain: `K-CONN-*`

## K-CONN-000 Runtime Target Identity v2 Hard Cut

`K-RTARGET-*` is the active target-identity authority. ConnectorService owns
remote credential custody only. Any older text in this file that admits local
connector identity, `LOCAL_MODEL`, or durable cloud target identity based on
`connector_id + model_id` is retired by K-RTARGET-002, K-RTARGET-003, and
K-RTARGET-006.

## K-CONN-001 Custodian Not Distributor

AI provider 凭据的唯一托管者是 Runtime ConnectorService。调用方通过 `connector_id` 引用凭据，不直接分发原始密钥。

- managed connector 的 credential truth 允许两类 admitted auth 形态：
  - `auth_kind=API_KEY`
  - `auth_kind=OAUTH_MANAGED`
- Runtime 在持久化层托管的是 provider-defined credential payload；执行层只消费请求作用域中被解出的最小凭据子集。

## K-CONN-002 Create Contract

CreateConnector 必须校验必填字段、注入默认 endpoint/label，并写入初始状态。

- authenticated caller 创建 user-owned remote managed connector（`owner_type=REALM_USER`, `owner_id=sub`）。
- anonymous caller 只能创建 `auth_kind=API_KEY` 的 machine-global remote managed connector（`owner_type=SYSTEM`, `owner_id="machine"`）。
- `owner_id="system"` 保留给 runtime config / env 注入的系统 connector，不允许通过 RPC 请求体声明。
- `auth_kind=API_KEY` 时，`api_key` 必填，`provider_auth_profile` 与 `credential_json` 禁填。
- `auth_kind=OAUTH_MANAGED` 时，必须存在 authenticated caller，并且 `provider_auth_profile` 与 `credential_json` 必填，`api_key` 禁填。
- `provider_auth_profile` 不是自由字符串；其唯一事实源是 `tables/connector-auth-profiles.yaml`，并且必须与 connector provider 保持兼容。
- `auth_kind` 省略时，服务端可按请求载荷推断：
  - `credential_json` 存在时推断为 `OAUTH_MANAGED`
  - 否则推断为 `API_KEY`

## K-CONN-003 Update Contract

UpdateConnector 必须校验可变字段集合；凭据或 endpoint 变化必须触发缓存失效。

- `owner_id="system"` 的 system-managed remote connector 保持 immutable。
- `owner_id="machine"` 的 machine-global remote connector 仅允许 `auth_kind=API_KEY` 形态，并允许 anonymous 与 authenticated 调用方更新。
- `auth_kind=OAUTH_MANAGED` connector 必须保持 `owner_type=REALM_USER`；发现非 user-owned 记录时必须 fail-close 并按 `NOT_FOUND` 隐藏。
- auth 相关 patch 必须保持 coherent final state：
  - `auth_kind=API_KEY` 不允许携带 `provider_auth_profile`
  - `auth_kind=OAUTH_MANAGED` 必须持有 `provider_auth_profile`
  - `provider_auth_profile` 必须继续属于 `tables/connector-auth-profiles.yaml` admitted set，并与现有 connector provider 保持兼容
  - `api_key` 与 `credential_json` 不得在同一次 patch 中并存
- 切换 auth kind 时必须显式补足目标形态所需 credential；不允许依赖隐式转换。

## K-CONN-004 Delete Compensation

DeleteConnector 必须执行级联清理与可恢复补偿流程。

- `owner_id="system"` 的 system-managed remote connector 不可删除。
- `owner_id="machine"` 的 machine-global remote connector 仅允许 `auth_kind=API_KEY` 形态，并允许 anonymous 与 authenticated 调用方删除。
- `auth_kind=OAUTH_MANAGED` connector 若不满足 user-owned 边界，删除路径必须 fail-close 并按 `NOT_FOUND` 隐藏。

## K-CONN-005 Snapshot-Only Connector Model Listing

`ListConnectorModels` 是 catalog read surface，必须只读 active catalog snapshot。

- remote provider 模型列表只能来自 active catalog snapshot。
- `force_refresh` 为允许字段，但必须是 no-op。
- `ListConnectorModels` 不得加载 connector credential、解析 endpoint、
  出站调用 provider model list API、执行 dynamic discovery、或承担 probe 语义。
- dynamic inventory policy 不能把此 RPC 重新解释为 live discovery surface；需要出站
  凭据/endpoint 探测时只能走 `TestConnector(remote)` 或已明确 admission 的
  scenario/execution path。

非 scenario 路径不得把 live discovery 结果提升为 catalog authority；它只
是 dynamic provider 的 execution-time inventory truth。

## K-CONN-006 Probe Preconditions

远端探测前必须通过 owner/status/credential 前置校验。

## K-CONN-007 List Models Boundaries

`TestConnector(remote)` 可以出站做连通性 / 凭据有效性探测，但不得承担模型发现、voice discovery 或 catalog 预热职责。

## K-CONN-008 Provider Canonical Domain

Connector provider 值域由 `provider-catalog.yaml` 管理，禁止非 canonical provider。

## K-CONN-009 Ownership Enforcement

Connector 的读写与探测必须遵循 owner 隔离与授权边界。

- user-owned remote connector 继续按 `sub` 隔离。
- machine-global remote connector 只适用于 `auth_kind=API_KEY`，并对当前 Runtime 实例上的所有调用方可见。
- `auth_kind=OAUTH_MANAGED` connector 只允许 user-owned；发现 machine/system-owned 记录时，读与探测路径必须按 `NOT_FOUND` 隐藏。
- system-managed remote connector 仅表示 runtime config / env 注入来源，保持只读。

## K-CONN-010 Audit Requirements

Connector 的创建、更新、删除、探测行为必须写入审计轨迹。

## K-CONN-011 Startup Recovery

进程启动时必须具备 delete-pending 等中间态恢复能力。

## K-CONN-012 Concurrency Safety

并发更新/删除必须有一致性保护，避免凭据与缓存状态撕裂。

## K-CONN-013 UpdateMask + optional Patch 语义

`UpdateConnectorRequest` 的 patch 语义必须满足：

- `update_mask.paths` 允许值固定为：`label`、`endpoint`、`api_key`、`status`、`auth_kind`、`provider_auth_profile`、`credential_json`。
- 当 `update_mask` 为空时，服务端必须从请求中显式出现的 optional 字段（`label`/`endpoint`/`api_key`/`auth_kind`/`provider_auth_profile`/`credential_json`）与 `status!=UNSPECIFIED` 推导有效更新路径。
- 推导后仍无有效路径时必须拒绝：`INVALID_ARGUMENT` + `AI_CONNECTOR_INVALID`。
- `update_mask` 出现未知路径，或路径被声明但对应 optional 字段未显式出现时，必须拒绝：`INVALID_ARGUMENT` + `AI_CONNECTOR_INVALID`。
- 不在有效更新路径中的字段必须保持不变（patch 语义，禁止隐式全量覆盖）。

## K-CONN-014 Connector 分页字段契约

Connector 列表 RPC 的分页字段必须成对出现并遵循统一边界：

- `ListConnectorsRequest` 与 `ListConnectorModelsRequest` 必须携带 `page_size/page_token`。
- `ListConnectorsResponse` 与 `ListConnectorModelsResponse` 必须返回 `next_page_token`（空字符串表示末页）。
- 默认分页值 `page_size=50`，最大值 `200`；超上限必须裁剪到上限，禁止回退为默认值。
- `page_token` 为空或缺失表示首页；非法 token 必须返回 `INVALID_ARGUMENT` + `PAGE_TOKEN_INVALID`。

## K-CONN-015 Connector owner 字段冻结

Connector 相关请求中的 `owner_id` 已冻结为 `reserved`，调用方不得通过请求体声明 owner。服务端 owner 归属必须由认证身份推导，并执行 `K-CONN-009` 的隔离规则。

## K-CONN-016 World Generate Connector Custody

当远端 provider admitted `world.generate` 时，connector custody 规则不变化：

- 调用方继续只提交 `connector_id`，不得提交原始 provider secret。
- world-generation provider 调用中的 upload / generate / poll / fetch-world
  凭据注入必须继续由 Runtime ConnectorService 托管。
- provider 返回 world asset URL 或 viewer URL 不得被解释为新的 credential
  ownership path。

## K-CONN-017 Memory Embedding Cloud Binding Reference Boundary

Resolved memory embedding profiles must retain the admitted typed cloud binding
identity. For a cloud profile, `connector_id`, `remote_model_catalog_id`,
`provider_model_id`, and `provider` remain the execution target identity carried
on the profile; `version`, raw `model_id`, or the retired connector/model pair
must not be reinterpreted as a durable cloud target.

当 Desktop-host-owned memory embedding live config 选择 `cloud` source 时，其
legal binding reference 必须继续服从 connector custody 规则。

固定规则：

- cloud memory embedding binding 必须引用 remote managed connector；host 持久化
  config 不得携带 raw provider secret、inline endpoint、或 provider-native
  credential fields
- admitted cloud binding shape 必须包含
  `connector_id + remote_model_catalog_id + provider_model_id + provider` 或其
  等价 typed reference；仅 `connector_id`，或 connector 与 raw `model_id` 的
  二元组，不构成完整 binding
- 被引用 connector 的 provider 必须属于 canonical provider domain，且继续受
  owner/status/credential 校验约束
- retired numeric local connector records 不得被 memory embedding cloud binding
  当作 legal remote reference
- connector custody 只拥有 credential 托管与 remote binding legality；resolved
  embedding profile、bank bind、以及 migration / cutover truth 仍由 runtime
  memory authority 拥有

## K-CONN-017a Live Provider Smoke TargetRef Boundary

Runtime live-provider smoke harnesses are execution-contract tests, not a
provider-config bypass. A remote-provider live smoke must create or use a
remote managed connector, resolve the selected model through
`ListConnectorModels`, and submit `ExecuteScenario` / `SubmitScenarioJob` with a
`RuntimeDurableCloudTargetRef` carrying `connector_id`,
`remote_model_catalog_id`, `provider_model_id`, and `provider`.

Local-provider live smoke must submit a `RuntimeDurableLocalTargetRef`. Raw
`model_id`, `version`, retired connector/model shortcuts, or a test-only
`Config.CloudProviders` service without typed target identity is not admitted
as a cloud execution target.

## K-CONN-018 OAuth-managed Lifecycle Boundary

`auth_kind=OAUTH_MANAGED` 的 runtime authority 固定为“托管 sealed payload 并在
consume/probe 时解出最小执行凭据子集”，而不是“拥有第三方 OAuth 登录与刷新
编排”。

固定规则：

- `credential_json` 是 provider-defined sealed payload；runtime 在当前 admitted
  scope 只要求其中能解出一个可用执行 token（例如 `api_key`、`access_token`、
  或 `token`）
- runtime 可以按 `provider_auth_profile` 为执行请求派生 provider-native
  headers，但不得因此把 provider-specific payload schema 提升为新的 proto
  truth
- runtime 在当前 admitted connector scope 内不拥有 browser/device-code login、refresh
  orchestration、或 token rotation 持久化语义；这些不属于 connector consume
  contract
- managed OAuth payload 若无法解出执行 token，probe 与 consume 必须返回
  `AI_CONNECTOR_CREDENTIAL_MISSING`
- 上游若以 401/403 或等价 provider-auth failure 拒绝 managed OAuth credential，
  runtime 必须 fail-close 为 `AI_PROVIDER_AUTH_FAILED`
- provider auth failure 不得触发 runtime 内部的隐式 refresh、fallback 到其他
  connector、或 credential payload 静默重写

第三方 OAuth acquisition 的 browser/device-code orchestration 若被产品化，必须由
SDK/host typed acquisition facade 拥有（见
`.nimi/spec/sdks/kernel/connector-auth-acquisition-contract.md`），并通过现有
`CreateConnector` / `UpdateConnector` sealed write path 交付 `credential_json`。
该 admission 不改变 Runtime ConnectorService 的 custody-only 边界。

## K-CONN-019 AIProfile Cloud Connector Slice Boundary

AIProfile cloud connector slices may declare non-secret cloud execution intent
for any admitted canonical AI capability.

Allowed portable/profile fields:

- profile-local `slice_id`;
- canonical Nimi capability;
- provider id from Runtime provider catalog;
- provider capability class;
- provider model id;
- non-secret connector selector / auth profile requirement;
- credential policy category;
- params and editable-field schema refs.

Runtime readiness output may select a concrete non-secret connector target
(`connector_id + remote_model_catalog_id + provider_model_id + provider` or
equivalent typed ref) for live AIConfig, but the
connector's credential payload remains Runtime-custodied.

`MUST NOT`:

- AIProfile, AIConfig, SDK state, Desktop storage, app manifests, or Kit UI state
  must not contain raw provider secret, API key, token, OAuth payload,
  credential JSON, authorization header, provider health evidence, quota,
  billing, or rate-limit state.
- Cloud connector slices must not carry local asset refs, backend packages,
  Python/Torch/CUDA requirements, selected source records, or local
  materialization evidence.
- Missing connector/credential/model/capability readiness produces
  connector-readiness or setup-required/no-live-config projection for required
  slices; it must not synthesize placeholder AIConfig.

---

<!-- source: .nimi/spec/runtime/kernel/model-service-contract.md -->

# Model Service Contract

> Owner Domain: `K-MODEL-*`

## K-MODEL-001 ModelDescriptor 结构

`ModelDescriptor` 表示 runtime 级模型注册信息。除基础字段外，runtime 必须暴露 runtime-native 本地模型元数据：

| 字段 | 类型 | 说明 |
|---|---|---|
| `model_id` | string | 模型唯一标识 |
| `version` | string | 版本 |
| `status` | `ModelStatus` | 模型状态 |
| `capabilities` | repeated string | 能力列表 |
| `last_health_at` | `Timestamp` | 最近健康检查时间 |
| `capability_profile` | `ModelCapabilityProfile` | 结构化能力画像 |
| `logical_model_id` | string | 逻辑模型 ID；passive asset 可为空，且不得作为 passive asset 文件路径真相 |
| `family` | string | 模型家族 |
| `artifact_roles` | repeated string | 解析后的 artifact 角色集合 |
| `preferred_engine` | string | 首选执行引擎，值域固定为 `llama` / `media` / `speech` / `sidecar` |
| `fallback_engines` | repeated string | 允许的 public fallback 引擎集合；不得暴露 `media.diffusers` 之类的 runtime 内部 driver |
| `bundle_state` | `LocalBundleState` | resolved bundle 状态 |
| `warm_state` | `LocalWarmState` | 预热状态 |
| `host_requirements` | `LocalHostRequirements` | 主机侧硬要求 |

## K-MODEL-002 Model 状态枚举

| 状态 | 值 | 含义 |
|---|---|---|
| `INSTALLED` | 1 | 已安装/已注册 |
| `PULLING` | 2 | 下载或解析中 |
| `FAILED` | 3 | 失败 |
| `REMOVED` | 4 | 已移除 |

## K-MODEL-003 ModelCapabilityProfile

`ModelCapabilityProfile` 继续作为能力摘要：

- `supports_text_generate`
- `supports_text_stream`
- `supports_embedding`
- `supports_image_generation`
- `supports_video_generation`
- `supports_speech_synthesis`
- `supports_speech_transcription`
- `supports_async_media_job`
- `supports_streaming`

该 profile 是摘要视图；runnable asset 的本地执行真相由 `logical_model_id + artifact_roles + preferred_engine + bundle_state + warm_state` 组合给出。passive asset 的路径真相由已安装 manifest (`source.repo=file://.../asset.manifest.json`) 与 `entry` 给出，`logical_model_id` 不参与路径解析。

## K-MODEL-004 RuntimeModelService 方法集合

`RuntimeModelService` 方法固定为：

1. `ListModels`
2. `PullModel`
3. `RemoveModel`
4. `CheckModelHealth`

## K-MODEL-005 PullModel 约束

- `app_id` 必填。
- `model_ref` 必填。
- `source` 可选。
- `digest` 可选。
- 返回 `task_id` + `accepted` + `reason_code`。
- 当目标为 runnable 本地 native model 时，runtime 在进入 `INSTALLED` 前必须完成最小的 logical model 元数据推导，至少写出 `logical_model_id`、`preferred_engine`、`bundle_state` 与 `warm_state`。passive asset 必须写出 `preferred_engine`、`bundle_state` 与 `warm_state`；不得从 `asset_id` 自动合成 `logical_model_id`。

## K-MODEL-006 CheckModelHealth 响应

- `healthy`：布尔健康状态。
- `reason_code`：失败原因。
- `action_hint`：建议操作。

对本地 native model，健康判断至少需要同时考虑：

- `bundle_state`
- `warm_state`
- 目标 engine 的真实 probe

仅凭“模型条目存在”或“进程可达”不得视为 healthy。

对本地 native model，`warm_state` 的投影规则还必须满足：

- `COLD` 表示“当前未加载/未预热”，属于 not-ready，不等于 unavailable
- `WARMING` 表示正在建立 ready 证明，属于 not-ready，不等于 unavailable
- `FAILED` 才表示最近一次 warm/load 失败
- 仅当 `warm_state=FAILED`、`bundle_state` 非 ready、或目标 engine / target probe 证明真实失败时，才允许投影为 unavailable / unhealthy

## K-MODEL-007 与 RuntimeLocalService 的关系

`RuntimeModelService` 提供统一视图，`RuntimeLocalService` 提供本地执行细节：

| 维度 | RuntimeModelService | RuntimeLocalService |
|---|---|---|
| 抽象层次 | 统一模型视图 | 本地执行/安装/生命周期细节 |
| 管理对象 | local + remote 模型 | 仅本地 logical model、artifact、service |
| 关注点 | capability 与 runtime-native 模型元数据 | install、bundle、health、warm、service |

数据流关系：

- `InstallVerifiedAsset` 成功后，本地模型必须同步反映到 `RuntimeModelService` 统一视图。
- `RuntimeModelService.ListModels` 是 Desktop/SDK 的统一模型目录入口。
- local model center、artifact intake、transfer/lifecycle 等本地模型管理 UI 可以并且应当直接依赖 `RuntimeLocalService`，而不是经 desktop host 维护第二套本地状态。
- `ListLocalAssets` / `ListLocalTransfers` 是本地控制面权威细节视图，不再被视为 desktop 专属降级镜像。
- `ListLocalAssets` 是权威细节视图的 inventory snapshot，不是 health orchestration surface。它不得同步触发本地 endpoint probe、engine bootstrap、warm execution、recovery accounting、状态迁移或持久化写入。
- 本地模型健康新鲜度由显式 `CheckLocalAssetHealth` / `WarmLocalAsset` / `StartLocalAsset` 与 runtime-owned background health maintainer 维护；Desktop/SDK 不得通过 list polling 或 renderer cache 建立第二套 health truth。

## K-MODEL-008 ModelStatus 状态机

`ModelStatus` 状态转换定义于 `tables/state-transitions.yaml` 的 `model_status` 机。合法转换：

| 源状态 | 目标状态 | 触发条件 |
|---|---|---|
| `INSTALLED` | `PULLING` | 拉取模型更新 |
| `PULLING` | `INSTALLED` | 拉取成功 |
| `PULLING` | `FAILED` | 拉取失败 |
| `INSTALLED` | `REMOVED` | 移除模型 |
| `FAILED` | `PULLING` | 重试拉取 |
| `FAILED` | `REMOVED` | 移除失败模型 |

不在此表中的转换为非法，实现必须拒绝。

## K-MODEL-009 Local Embedding Binding Reference Legality

当 Desktop-host-owned memory embedding live config 选择 `local` source 时，
binding reference 的合法性由 runtime local/model authority 冻结。

固定规则：

- admitted local binding 必须使用 typed local target reference，指向 runtime
  authoritative local inventory 中的 embedding-capable target；不得退化成 raw
  filesystem path、engine 名称、或 renderer-local asset heuristic
- 该 local target reference 必须能被 `RuntimeLocalService` /
  `RuntimeModelService` 的 authoritative inventory 解析
- 被引用 target 必须证明具备 embedding capability；不具备 embedding capability
  的 local model / asset 不构成 legal binding
- binding legality 与 readiness 必须分离：引用合法不等于当前 healthy /
  warm / ready；resolved availability 仍由 runtime health / warm / bundle truth
  决定
- Desktop/SDK 不得通过“有某个本地文件/asset 存在”来推断 legal local memory
  embedding binding；合法性必须来自 admitted runtime local/model authority

## K-MODEL-010 Runtime-Local Algorithm Authority

Runtime owns the local model recommendation, install, registry, and download
algorithms. Desktop, Web, and Kit consume these decisions through SDK / Runtime
projection only.

Runtime-owned algorithm surfaces:

- device profile matching and engine support classification
- recommendation memory budget and tier allocation
- dependency resolver stage ordering
- local model registry identity resolution
- artifact download staging, verification, commit, resume, and progress truth

Cross-owner split:

- `device-profile-contract.md` owns `LocalDeviceProfile` collection and host
  capability evidence.
- `local-engine-contract.md` owns public engine taxonomy and supervised/attached
  runtime modes.
- `local-engine-resolver-contract.md` owns engine/host compatibility and
  resolver rules.
- `local-environment-materializers-contract.md` owns dependency materialization,
  verification, activation, and repair evidence.
- `model-catalog-contract.md` owns catalog identity and provider/source
  metadata.
- this `model-service-contract.md` owns model registry identity, health, model
  status, and local/remote model projection.

## K-MODEL-011 Recommendation Budget And Fit Projection

Runtime recommendation may expose fit tiers such as recommended/runnable/tight
or not-recommended, but the calculation is Runtime-owned.

`MUST`:

- use `LocalDeviceProfile` and runtime local engine/catalog evidence as inputs
- keep confidence, memory budget, context/window, quantization, file metadata,
  and capability fit as typed Runtime evidence
- fail closed when required metadata is absent instead of silently accepting an
  unsupported install path

`MUST NOT`:

- let Desktop provider/model defaults, renderer cache, or Tauri host state
  substitute for Runtime fit evidence
- let a recommendation result become install success or readiness truth

## K-MODEL-012 Dependency Resolver Ordering

Runtime dependency resolution owns required/optional/alternative stage ordering
for local model and profile materialization.

Fixed semantics:

- required dependencies must be satisfied or the plan fails closed
- optional dependencies may be skipped without creating pseudo-success
- alternatives choose one admitted match and record why other choices were not
  selected
- resolver output must be stable for the same catalog, host evidence, and user
  posture inputs

Desktop may display the selected plan and warnings; it must not run a parallel
dependency resolver.

## K-MODEL-013 Registry Identity Resolution

Runtime owns local model registry identity.

`MUST`:

- resolve existing entries before inserting new records
- prevent duplicate identities across normalized model id, engine, logical
  model id, and local asset identity where the relevant fields exist
- rebuild capability indexes from Runtime registry truth, excluding removed
  records
- preserve file metadata and manifest evidence as part of recommendation and
  health confidence

Desktop may not create, merge, or repair registry rows through a Desktop-owned
identity heuristic.

## K-MODEL-014 Artifact Download Atomicity

Runtime owns artifact transfer atomicity for local model/materialized asset
downloads.

`MUST`:

- stage downloads outside committed resolved storage
- verify required hashes/manifests before commit
- commit atomically or roll back without leaving partial committed artifacts
- expose durable transfer/progress state that survives renderer reload
- resume only when Runtime can prove the staged bytes belong to the same
  transfer identity

`MUST NOT`:

- let Desktop/Tauri download progress events be the only terminal evidence
- mark an install ready before Runtime registry, manifest, and health evidence
  agree

---

<!-- source: .nimi/spec/runtime/kernel/multimodal-provider-contract.md -->

# Runtime Multimodal Provider Contract

> Owner Domain: `K-MMPROV-*`

## K-MMPROV-001 Canonical Common Head

多模态 canonical 请求头字段集合由 `multimodal-canonical-fields.yaml` 管理。

`TEXT_GENERATE` 与 `TEXT_EMBED` 的主字段契约为 proto-first：以 `ScenarioSpec.text_generate` / `ScenarioSpec.text_embed` 为权威，不经 `multimodal-canonical-fields.yaml` 派生。

## K-MMPROV-002 Image Spec Contract

图像生成字段（prompt、size、quality、seed 等）必须在请求前可校验。

## K-MMPROV-003 Video Spec Contract

视频生成必须使用结构化规范 `mode + content[] + options`，并在请求前可校验。  
Legacy 字段（`first_frame_uri` / `last_frame_uri` / `camera_motion`）不得作为视频主契约输入字段。

## K-MMPROV-004 TTS Spec Contract

语音合成字段（voice/language/format/rate）必须在请求前可校验。

## K-MMPROV-005 STT Spec Contract

语音转写字段（audio_source/language/timestamps）必须在请求前可校验。

## K-MMPROV-006 Async Job First-Class

异步任务（特别是视频/长音频）必须作为一等能力，遵循 `K-JOB-*`。

## K-MMPROV-007 Artifact Meta Contract

artifact 元数据字段集合由 `multimodal-artifact-fields.yaml` 管理，必须支持 URL 与 inline 双模式。

## K-MMPROV-008 Adapter Obligations

每个 provider adapter 必须实现请求映射、响应归一化、reason code 归一化。

## K-MMPROV-009 Cloud Route Constraints

cloud 模态路由必须显式可观测，不得伪造成功响应。

## K-MMPROV-010 Local Provider Constraints

local provider 的能力暴露必须与本地 engine/capability 合同一致。

`media` 补充：

- `tables/local-image-supervised-backend-matrix.yaml`（v2）是 canonical local image supervised backend matrix 的唯一事实源。runtime 必须通过统一 resolver 消费 v2 matrix entries，不得在 localservice、ai execution、daemon 各自推断 image supervised 路径。
- v2 matrix 按 `entry_id` 索引，以 `platform + asset_family + backend_family + profile_kind` 标识 topology 槽位。`topology_state` 与 `product_state` 分离；只有 `product_state=supported` 的 entry 才允许进入 install recommendation、activation、ready health success。
- runtime 到 `media` engine 的私有协议必须直接承接 runtime canonical image/video spec，不得回落到 OpenAI-compatible `/v1/images/generations`、`/v1/video/generations` 或 legacy catalog-only 健康路径。
- `media` engine 私有协议固定为：`GET /healthz`、`GET /v1/catalog`、`POST /v1/media/image/generate`、`POST /v1/media/video/generate`。
- `proxy_execution` 与 `pipeline_supervised` 共享同一 canonical HTTP surface；request body 与 artifact response envelope 在两种 mode 下保持同形，但 `proxy_execution` 不得再通过 llama route 承载稳定 image product path。
- 对 v2 matrix resolver 选中的 `backend_class=native_binary` + `backend_family=stablediffusion-ggml` image 路径，dynamic profile import 如需额外 materialization 步骤，只允许作为 runtime 私有内部实现存在；app-facing consume 仍必须固定落到 `POST /v1/media/image/generate`。
- 对 v2 matrix resolver 选中的 `backend_class=native_binary` + `backend_family=stablediffusion-ggml` + `asset_family=safetensors_native_image` image 路径，适用与 `gguf_image` 相同的 native binary execution 规则；但 `product_state` 独立于 `gguf_image`，未经 host tuple 验证前保持 `unsupported`。
- 对 v2 matrix resolver 选中的 `backend_class=python_pipeline` + `backend_family=diffusers` image 路径，必须确认该 entry 的 `product_state` 已达到 `supported` 且 `admission_gate` 已通过，方可进入 install / activation / execution。
- 对 canonical local image product path，runtime 不得将 host 不支持误投影成 `ATTACHED_ENDPOINT + AI_LOCAL_ENDPOINT_REQUIRED`；必须保持 `SUPERVISED` 契约并以 `AI_LOCAL_MODEL_UNAVAILABLE + compatibility detail` fail-close。
- `media` 只允许暴露真实 ready 的 image/video 模型目录；依赖未安装、设备不可用、模型未解析、管线未初始化时必须 fail-close，不得伪造成功 artifact 或静态 model list。
- `media.diffusers` 只允许作为 `media` 的内部 fallback driver 出现在 runtime metadata / execution strategy；不得作为 public config、public adapter 选择面或手工 engine target。当前 kernel 基线仍规定 `media.diffusers` 不得在未完成规范修订前直接升格为 matrix-supported canonical path。
- `backend_family`、`backend_class`、`product_state` 等 v2 matrix 字段只允许落在 runtime-private resolved detail、provider hints `extra`、audit detail；本轮不新增 typed proto 字段（K-LENG-015）。

`speech` 补充：

- runtime 到 `speech` engine 的私有协议必须直接承接 runtime canonical speech 与 voice workflow spec，不得伪装成 OpenAI-compatible TTS/STT workflow 成功语义。
- `speech` engine 私有协议固定为：`GET /healthz`、`GET /v1/catalog`、`POST /v1/audio/transcriptions`、`POST /v1/audio/speech`、`POST /v1/voice/clone`、`POST /v1/voice/design`。
- `speech` 只允许暴露真实 ready 的 STT/TTS/voice workflow 模型目录；缺失 admitted `Qwen3-ASR` / `Qwen3-TTS` bundle 或 target workflow bundle 时必须 fail-close。
- `speech` supervised host 必须显式区分 placeholder state 与 admitted plain-speech state：
  - placeholder state 下，`GET /healthz` 只回答 host 可达与 placeholder state；不得伪装 execution-plane ready。
  - admitted plain-speech state 下，`GET /healthz` 只有在 local plain-speech minimum admitted proof 成立后，才允许返回 `ready=true`。
- `GET /v1/catalog` 在 placeholder state 下只允许暴露 placeholder / non-ready rows；在 admitted state 下，只有当 target row 满足 admitted plain-speech proof 且 row capability 与 admitted capability truth 一致时，才允许暴露 ready rows。
- 在 admitted local plain-speech execution plane 尚未 materialize 前，`POST /v1/audio/transcriptions` 与 `POST /v1/audio/speech` 必须继续 fail-close 为 plain-speech execution-plane unavailable，而不是 generic speech success 或 silent downgrade。
- `speech` 的 public diagnostics / detail 不得暴露 raw request payload、runtime-private bootstrap path、或 raw probe URL；若需要更细原因字段，只允许进入 runtime-private detail / audit surface。
- 在 local workflow execution plane 尚未 admitted 前，`/v1/voice/clone` 与 `/v1/voice/design` 必须明确返回 capability-not-admitted / fail-close 语义，而不是 generic speech success 或静默降级。
- plain-speech admitted driver family 不得被隐式提升为 workflow-family admission truth；后续 workflow-capable local family（包括历史讨论过的 `voxcpm`、`omnivoice`）若要 admitted，必须拥有独立的 workflow model / binding / handle policy truth。
- workflow-capable TTS family 的成功结果不得替代 `audio.transcribe` 验收；speech 全链路成功必须继续保留独立 STT family truth。
- 当 local workflow execution 进入 first-family admission 时：
  - `/v1/voice/clone` 与 `/v1/voice/design` 只允许对 admitted family 返回成功
  - 当前 baseline admitted family 边界固定为 `qwen3_tts`
  - unsupported local workflow family（包括 `voxcpm`、`omnivoice`）必须继续返回 family-scoped fail-close，而不是 generic local speech success
  - `GET /healthz` 与 `GET /v1/catalog` 仍不得把某一 admitted workflow family 的成功投影为 generic local workflow-ready

## K-MMPROV-011 Workflow External Async

workflow 外部异步节点事件语义必须与多模态任务生命周期对齐。

## K-MMPROV-012 Validation & Fail-Close

字段不支持、策略不通过、provider 不可用时必须 fail-close。

## K-MMPROV-013 DashScope Voice Catalog Primary Path

DashScope TTS 的 voice 解析主路径必须由 catalog 驱动（权威定义见 `K-MCAT-007`）。兼容模式 voice endpoint 探测不得作为主路径。

## K-MMPROV-014 Cross-Layer Traceable Voice Diagnostics

TTS voice 解析与校验日志必须可观测 `catalog_source`、`model_resolved` 与 `voice_count`，用于 Runtime → SDK → Desktop 统一排障。

## K-MMPROV-015 DashScope Voice Legacy Bypass Forbidden

针对 DashScope，禁止以 legacy/hardcode voice 兜底绕过 catalog 校验。

## K-MMPROV-016 Local Media Canonical Image Workflow Mapping

Runtime 在不引入 DAG 编排的前提下，必须支持 canonical local image workflow（t2i/i2i）：

- t2i：当 `reference_images` 为空时，不下发 `file/files/ref_images`。
- i2i：`reference_images[0] -> file`，`reference_images -> files`，`reference_images[1:] -> ref_images`。
- `negative_prompt` 存在时，必须透传 `negative_prompt`。
- 本地路由（`local/*`）必须基于已解析 engine（`llama` / `media` / `sidecar`）推断 providerType，避免 adapter 误判。
- `nimi.scenario.image.request` 命名空间允许 runtime 接收 `profile_overrides`：
  - image workflow 的 slot 依赖（`vae_path`、`llm_path`、`lora_path`、`controlnet_path` 等）由 runtime 从当前 profile 的已安装 passive asset entries 按 `engineSlot` 解析注入（`K-LOCAL-031`），不再由调用方通过 `components[]` 显式提供。
  - slot 路径解析必须消费已安装 asset 的 `source.repo=file://.../asset.manifest.json` 与 `entry`；`local-import/*` 只能是 asset id 命名空间，不能作为 repo、logical id 或 resolved path fallback。
  - 当 profile 中缺失 workflow 必需的 `engineSlot` 绑定时，runtime 必须 fail-close（`AI_INPUT_INVALID`），不得猜测 companion 或使用默认值。
  - `profile_overrides` 允许覆盖非路径 profile 字段（`K-LOCAL-032`）；`parameters.model`、`download_files` 与任何 `*_path` 原始值必须由 runtime 注入或拒绝。
  - `profile_overrides` 单独存在但 profile 未绑定对应 slot asset 时，不得触发 dynamic import。
  - runtime 渲染完成后，必须从 forwarded extensions 中移除 `profile_overrides`。
- image `response_format` 只允许 `b64_json`、`base64`（归一化为 `b64_json`）或 `url`；其他值必须 fail-close（`AI_MEDIA_OPTION_UNSUPPORTED`）。
- 当 provider 返回 URL artifact 时，runtime 下载必须继承父请求 `ctx`，并施加有界读取上限；超时、取消、空载荷或超限载荷必须 fail-close（`AI_OUTPUT_INVALID`）。

| 场景 | 输入条件 | Runtime 动作 | 结果 |
|---|---|---|---|
| t2i | `reference_images` 为空 | 不下发 `file/files/ref_images` | 仅按文本生成 |
| i2i | `reference_images` 非空 | `reference_images[0] -> file`，`reference_images -> files`，`reference_images[1:] -> ref_images` | 形成最简 image-to-image 映射 |
| negative prompt 透传 | `negative_prompt` 存在 | 始终透传 `negative_prompt` | 不得静默丢弃 |
| workflow slot 缺失 | profile 缺失 workflow 必需的 `engineSlot` 绑定 | fail-close | `AI_INPUT_INVALID` |
| slot asset 不可用 | profile slot asset 未安装或 `UNHEALTHY` | fail-close | `AI_INPUT_INVALID` |
| profile overrides 越界 | `profile_overrides` 触碰 `parameters.model`、`download_files` 或任何 `*_path`，或 profile 未绑定 slot asset 却触发 dynamic import | 由 runtime 注入或拒绝 | fail-close 或忽略 dynamic import |
| response_format 合法 | `response_format` 为 `b64_json`、`base64`、`url` | `base64 -> b64_json` 归一化，其余透传 | 保持兼容 |
| response_format 非法 | `response_format` 为其他值 | fail-close | `AI_MEDIA_OPTION_UNSUPPORTED` |
| URL artifact 下载失败 | provider 返回 URL artifact，且下载出现超时、取消、空载荷或超限载荷 | 下载继承父请求 `ctx` 且使用有界读取 | `AI_OUTPUT_INVALID` |

## K-MMPROV-017 Legacy Image Option Reject Strategy

本地 image 路径不得继续为 legacy `LocalAI/Nexa` 选项名保留 public contract 兼容。对没有 canonical 同名语义的遗留键：

- `extensions.step` 优先；`extensions.steps` 在 `step` 缺失时映射到 `step`。
- `extensions.mode` 优先；`extensions.method` 在 `mode` 缺失时映射到 `mode`。
- 对当前路径无稳定同名请求字段的键（`guidance_scale` / `eta` / `strength` / `clip_skip`）不得 fail-close，必须以 ignored 形式可观测回传。
- image artifact `ScenarioArtifact.metadata` 必须至少包含：
  - `adapter`
  - `prompt`
  - `source_image`
  - `ref_images_count`
  - `local.applied_options`
  - `local.ignored_options`

| 输入键 | 优先级/映射 | Runtime 动作 | 可观测结果 |
|---|---|---|---|
| `extensions.step` | 第一优先级 | 直接写入 `step` | 记入 `local.applied_options` |
| `extensions.steps` | 仅当 `step` 缺失 | 映射到 `step` | 记入 `local.applied_options` |
| `extensions.mode` | 第一优先级 | 直接写入 `mode` | 记入 `local.applied_options` |
| `extensions.method` | 仅当 `mode` 缺失 | 映射到 `mode` | 记入 `local.applied_options` |
| `guidance_scale` | 无稳定同名请求字段 | 不 fail-close | 记入 `local.ignored_options` |
| `eta` / `strength` / `clip_skip` | 无稳定同名请求字段 | 不 fail-close | 记入 `local.ignored_options` |
| artifact metadata | 成功返回 image artifact | 写入 `ScenarioArtifact.metadata`，至少填充 `adapter`、`prompt`、`source_image`、`ref_images_count`、`local.applied_options`、`local.ignored_options` | 供排障与兼容性回放 |

## K-MMPROV-018 TTS VoiceReference Primary Contract

TTS v2 合成请求主入口必须是强类型 `voice_ref`，不允许回退到自由字符串 voice 字段。

## K-MMPROV-019 Voice Workflow Canonical Inputs

Voice 工作流 canonical 输入字段（`voice_clone` / `voice_design`）由 `multimodal-canonical-fields.yaml` 管理，provider 不得以隐式参数替代必填字段约束。

对 `voice_clone`，canonical 输入允许可选 `voice_clone.text`。当 provider 明确要求提供参考音频的 transcript / text 描述时，必须显式透传并在缺失时 fail-close；禁止 runtime 伪造 transcript。

provider extension 若暴露 `base_url` 覆写入口，仅允许与当前 provider 基线 endpoint 保持同一 scheme、host 与 canonical base path。不得借由 same-origin 不同 path 的覆写把请求转发到管理端点、私有运维路径或其它非 voice workflow API 面。

当前 workflow provider extension 中仅用于 transport / adapter routing 的键，
包括 `api_key_header`、`base_url`、`headers`、`workflow_paths`、
`clone_paths`、`design_paths`、`preview_paths`、`create_paths`，属于
runtime-private validation / execution detail。它们不得被 source catalog、
snapshot、或 app-facing route describe 升格为 canonical provider truth。

## K-MMPROV-020 Voice Workflow Fail-Close

Voice 工作流输入不完整、workflow 不支持、目标模型不匹配、资产状态非法时必须 fail-close，不得自动降级到 provider 默认 voice。

## K-MMPROV-021 TTS Timing & Render Hint Canonical Fields

TTS v2 在保持 provider 可扩展参数的同时，必须将跨 provider 高价值字段强类型化：

- `timing_mode`（`none|word|char`）
- `voice_render_hints.stability`
- `voice_render_hints.similarity_boost`
- `voice_render_hints.style`
- `voice_render_hints.use_speaker_boost`
- `voice_render_hints.speed`

以上字段事实源由 `multimodal-canonical-fields.yaml` 管理；产物对齐字段由 `multimodal-artifact-fields.yaml` 管理。

## K-MMPROV-022 Timing/Alignment Fail-Close Mapping

当调用方请求 `timing_mode=word|char` 时：

- provider 若支持，必须返回结构化 `speech_alignment`；
- provider 若不支持，必须 fail-close（`AI_MEDIA_OPTION_UNSUPPORTED` 或 provider 明确错误映射），禁止静默忽略或降级为 `none`。

## K-MMPROV-023 ElevenLabs Status Mapping Baseline

针对 ElevenLabs（及同类 TTS provider）适配器，HTTP 状态码最小映射基线为：

- `401|403` -> `AI_PROVIDER_AUTH_FAILED`
- `429` -> `AI_PROVIDER_RATE_LIMITED`
- `400|422` -> `AI_VOICE_INPUT_INVALID`（创建音色）或 `AI_MEDIA_OPTION_UNSUPPORTED`（合成参数）
- 目标模型/音色不兼容 -> `AI_VOICE_TARGET_MODEL_MISMATCH`
- 资产不可见或越权 -> `AI_VOICE_ASSET_SCOPE_FORBIDDEN`
- `5xx` -> `AI_PROVIDER_INTERNAL`
- 超时 -> `AI_PROVIDER_TIMEOUT`

## K-MMPROV-023a Plain Speech Route Describe Metadata Discipline

对 plain speech capability，runtime route describe metadata 必须保持 capability-scoped：

- `audio.synthesize` metadata 只允许描述当前 resolved synthesis route 的音频格式、timing mode、语言/情感字段可用性、以及 source-authored option schema
- `audio.transcribe` metadata 只允许描述当前 resolved transcription route 的 transcript tier、response format、以及 source-authored option schema
- 若 source/catalog 未提供最小 speech metadata truth，`runtime.route.describe(audio.synthesize|audio.transcribe)` 必须 fail-close
- Desktop/SDK 不得因为 provider/engine 共享同一 `speech` host 就推断另一 capability 的 metadata 存在

Native streaming TTS support：

- native streaming TTS support 是 `audio.synthesize` 下的一个 provider/route
  metadata 事实，事实源为 `tables/tts-provider-capability-matrix.yaml`
  `supports_native_stream_tts`。它不新增 canonical capability token；
  `audio.synthesize` 仍是唯一 speech synthesis capability。
- `runtime.route.describe(audio.synthesize)` 可以在 metadata 中暴露该 route 是否
  支持 native streaming（可播放非终帧音频先于合成完成），但必须来自声明事实，
  不得由 provider 名称、route kind、endpoint family、或 local/cloud 假设推断。
- 未声明 `supports_native_stream_tts=true` 的 route 不得被 fallback 分片提升为
  `native_stream`；此类 route 的流式路径只能是 `simulated_stream` 或按策略
  fail-close（见 `K-VOICE-019`、`K-STREAM-004`）。
- `tables/tts-provider-capability-matrix.yaml` 只可将 named provider route 置为
  `supports_native_stream_tts=true`；DashScope CosyVoice WebSocket
  SpeechSynthesizer 是当前 admitted contract/adapter route。`product-green`
  readiness 仍必须通过 acceptance matrix 的 named live-provider proof 关闭；
  未被命名和证明的 route 仍处于 blocked 状态，不得伪造 provider readiness。

## K-MMPROV-024 Video Mode/Role Matrix

Video mode 与 content role 组合必须严格匹配：

- `t2v`：至少 1 条 `TEXT+PROMPT`，禁止 `FIRST_FRAME/LAST_FRAME/REFERENCE_IMAGE`。
- `i2v_first_frame`：必须且仅 1 条 `IMAGE_URL+FIRST_FRAME`，可附文本 prompt。
- `i2v_first_last`：必须包含 `IMAGE_URL+FIRST_FRAME` 与 `IMAGE_URL+LAST_FRAME` 各 1 条，可附文本 prompt。
- `i2v_reference`：必须包含至少 1 条 `IMAGE_URL+REFERENCE_IMAGE`，可附文本 prompt。

`prompt` 在 `t2v` 模式下为必需字段；在 `i2v_*` 模式下是否必需由 provider/model 能力与输入角色合同决定，但若出现文本内容，则必须以 `TEXT+PROMPT` 角色表达。

所有模式均可附加可选的 `VIDEO_URL+REFERENCE_VIDEO` 与 `AUDIO_URL+REFERENCE_AUDIO`，用于视频风格参考和背景音频输入。provider/model 是否支持这些可选角色及其最大数量由 catalog `input_roles + limits` 声明决定；runtime 不得把 source/snapshot 中声明的“允许角色集合”误解释为“每次请求必须显式提供的完整角色集合”。

当请求包含 `AUDIO_URL+REFERENCE_AUDIO` 时，必须同时存在至少一个视觉参考输入（`FIRST_FRAME` / `LAST_FRAME` / `REFERENCE_IMAGE` / `REFERENCE_VIDEO` 之一）；不得接受“仅文本 + 音频参考”的无视觉锚点请求。

任一 mode/role 冲突必须 fail-close（`AI_MEDIA_SPEC_INVALID` 或 `AI_MEDIA_OPTION_UNSUPPORTED`）。

## K-MMPROV-025 Video Option Guardrails

Video options 最小强校验基线：

- `frames` 与 `duration_sec` 互斥，冲突必须 fail-close。
- `seed` 范围固定 `[-1, 4294967295]`。
- `i2v_reference` 禁止 `camera_fixed=true`。
- `ratio` / `resolution` 必须经过 provider/model 能力矩阵校验。

## K-MMPROV-026 Volcengine Seedance Task Endpoints

Volcengine Seedance（第一批视频 provider）固定任务接口：

- submit: `POST /api/v3/contents/generations/tasks`
- query: `GET /api/v3/contents/generations/tasks/{task_id}`

adapter 请求体必须使用 `content[] + role` 语义，不得回退到 legacy 视频字段拼装。

## K-MMPROV-027 Async Task Status Normalization

provider 异步任务状态必须归一化到：

- `queued`
- `running`
- `cancelled`
- `succeeded`
- `failed`
- `expired`

运行时语义要求：

- `cancelled` -> Job `CANCELED`
- `expired` -> Job `TIMEOUT`
- `failed` -> Job `FAILED`

## K-MMPROV-028 TTS Layered Inclusion Baseline

TTS provider 纳入执行以下分层规则：

- `tts_synthesize` 为基础必备能力；
- `voice_clone` 与 `voice_design` 为可选增量能力；
- 对仅 synthesize provider，不得要求其提供 voice workflow 强行对齐。

## K-MMPROV-029 Deferred Custom Voice Extension

云厂训练型 Custom Voice（训练作业、审批流程或长期部署语义）在本轮必须保持 provider extension 形态。
在形成跨 provider 可验证强类型抽象前，不得强行映射为标准 `voice_clone` / `voice_design` 成功语义。

## K-MMPROV-030 Text Chat Multimodal Preflight Guard

`TEXT_GENERATE` 场景接受多模态 `ChatContentPart`（`parts` 字段）时，runtime 必须在调用 provider 前执行逐项模态预检：

- `IMAGE_URL` -> 必须校验 `text.generate.vision`
- `AUDIO_URL` -> 必须校验 `text.generate.audio`
- `VIDEO_URL` -> 必须校验 `text.generate.video`
- `ARTIFACT_REF` -> 必须先解析为可消费的 image/audio/video 输入，再按解析后的模态执行能力预检
- 目标模型未声明对应 capability 时，必须 fail-close 返回 `AI_MODALITY_NOT_SUPPORTED`（K-NIMI-009）
- catalog 中未找到模型条目时，允许放行；但 provider adapter 若缺少该模态映射，仍必须在执行前 fail-close，不得静默降级
- 未知或未实现的 text-chat part type 必须返回 `AI_MEDIA_OPTION_UNSUPPORTED`

`TEXT_GENERATE` v2 的输入/输出边界：

- 输出始终是 text；媒体输出不得通过 `TEXT_GENERATE` 返回
- 输入允许 `text`、`image_url`、`audio_url`、`video_url`、`artifact_ref`
- 大媒体输入仅允许 `URL` 或 `artifact_ref`；inline binary / data URI 不得作为 text chat runtime contract
- media-only prompt 合法；但 system-only 或空内容请求必须 fail-close 为 `AI_INPUT_INVALID`

## K-MMPROV-031 Realtime Session Contract Boundary

双向低延迟 text/audio 会话不得塞入 `AIService` 既有 scenario RPC；必须通过独立 `RuntimeAiRealtimeService` 暴露。

- `OpenRealtimeSession` 负责会话建立与 route/model 决策
- `AppendRealtimeInput` 负责增量输入（text/audio）
- `ReadRealtimeEvents` 负责 text delta / audio chunk / terminal event 的 server stream
- `CloseRealtimeSession` 负责显式结束会话
- v1 provider-backed realtime 只要求 llama text+audio：
  - 输入允许 `ChatMessage(TEXT parts only)` 与 `RealtimeAudioInput`
  - 输出允许 `RealtimeTextDelta`、`RealtimeAudioChunk`、`RealtimeCompleted`、`RealtimeFailed`
  - 单 session 只允许一个活跃 reader；冲突 reader 必须 fail-close
- 其他 provider 若尚未实现 realtime，runtime 必须显式返回 unsupported / unimplemented，不得伪造成普通 `TEXT_GENERATE` 流式响应

Agent voice output 边界：

- `RuntimeAiRealtimeService` 是独立的 realtime multimodal session API，不是
  ordinary agent voice output。它当前不承载 `VoiceReference` / `VoiceAsset` /
  committed assistant text / turn·message identity / final replay artifact /
  voice-playback interrupt 语义。
- ordinary Runtime Agent 自定义音色语音输出必须走 scenario-layer
  `audio.synthesize` 语义（含其 native/simulated streaming path），不得直接把
  realtime session RPC 当作 agent voice output（见 `K-VOICE-019`、`K-AGCORE-133`）。
- `RealtimeAudioChunk audio_chunk` 只属于 realtime session 事件流，不得被复用为
  scenario 语音流 delta 字段或 agent voice stream chunk 字段。
- 未来若要把 realtime 包装为内部 transport，必须先证明它能对 committed text 以
  custom `VoiceReference(voice_asset_id)` 合成，否则保持 out of scope。

## K-MMPROV-032 AI Artifact Upload Ingress

大媒体 upload-first ingress 必须通过 `RuntimeAiService.UploadArtifact` 暴露，供 `artifact_ref.artifact_id` 在 `TEXT_GENERATE` 与 realtime 中复用。

- RPC 形态固定为 client-stream：
  - 首帧必须携带 `UploadArtifactMetadata`
  - 后续帧必须携带按序 `UploadArtifactChunk`
- v1 允许的媒体范围仅为 `image/*`、`audio/*`、`video/*`
- 上传完成前不得被 scenario 或 realtime 消费
- `UploadArtifact` 返回的 `artifact_id` 只能在同 app / subject 作用域内消费
- v1 不要求 resumable / multipart lifecycle；单次 upload 完成即得 `artifact_ref.artifact_id`
- 非法首帧、mime 或 chunk 序号必须返回 `AI_ARTIFACT_UPLOAD_INVALID`
- 超限上传必须返回 `AI_ARTIFACT_UPLOAD_TOO_LARGE`

## K-MMPROV-033 Remote OpenAI Text Multimodal Baseline

远端 OpenAI text-chat multimodal provider-specific mapper 的 v1 基线固定为 `image + audio`。

- `IMAGE_URL` 继续走 provider-native `image_url`
- `AUDIO_URL` 与可解析的 `artifact_ref(audio)` 必须映射为 provider-native audio input part
- `VIDEO_URL` 与 `artifact_ref(video)` 在远端 OpenAI 路径本轮必须 fail-close 为 `AI_MEDIA_OPTION_UNSUPPORTED`
- generic OpenAI-compatible mapper 不得假装支持 audio/video；只有明确 provider-native `openai` mapper 才能放开 `text.generate.audio`

## K-MMPROV-034 `nimi.scenario.music_generate.request` v1

`MUSIC_GENERATE` 可通过 `ScenarioExtension.namespace = "nimi.scenario.music_generate.request"` 承载 v1 iteration 扩展。该扩展仅定义以下字段：

- `mode`: `extend | remix | reference`
- `source_audio_base64`: iteration 模式必填
- `source_mime_type`: 可选
- `trim_start_sec`: 可选
- `trim_end_sec`: 可选

除上述字段外，runtime 不得把未知 key 继续下传 provider。

当请求携带该扩展时，runtime 必须额外校验模型在 catalog 中声明了 `music.generate.iteration` capability；未声明则必须 fail-close。

## K-MMPROV-035 Music Iteration Fail-Close

- 无扩展时，`MUSIC_GENERATE` 视为 prompt-only 路径。
- 扩展存在但 `mode` 非法、缺 `source_audio_base64`、base64 无法解码、trim 为负值、或 `trim_end_sec <= trim_start_sec` 时，runtime 必须返回 `AI_MEDIA_SPEC_INVALID`。
- provider 不支持该 iteration 语义时，runtime 必须返回 `AI_MEDIA_OPTION_UNSUPPORTED`。
- capability 已声明但 runtime 内部没有对应 provider strategy 时，仍必须返回 `AI_MEDIA_OPTION_UNSUPPORTED`。

## K-MMPROV-036 Capability-Gated Iteration Baseline

iteration 支持必须由 `music.generate.iteration` capability 与 runtime provider strategy 共同决定，不能只靠 provider 名字硬编码。

- `stability` 是当前官方闭源基线 provider，必须显式声明 `music.generate.iteration` capability，并消费 runtime 规范化后的 typed iteration 输入。
- `soundverse`、`mubert`、`loudly` 当前规范基线只要求 `music.generate` prompt-only；若未声明 `music.generate.iteration` capability，则带 iteration 扩展时必须 fail-close。
- `local` provider 当前规范基线只要求 prompt-only；`sidecar` 本地 backend 后续可在声明 capability 后增量开放 iteration。
- 本规则不新增新的顶层 RPC；iteration 继续复用通用 `ScenarioJob` / artifact 契约。

## K-MMPROV-037 Stable AI Output Typed Contract

稳定 AI product surface 不得再以 `google.protobuf.Struct` 作为主输出契约承载。runtime 必须使用显式 typed proto message：

- sync `TEXT_GENERATE` -> `ExecuteScenarioResponse.output.text_generate.text`
- sync `TEXT_EMBED` -> `ExecuteScenarioResponse.output.text_embed.vectors[]`
- async `SPEECH_TRANSCRIBE` -> `GetScenarioArtifactsResponse.output.speech_transcribe.text`
- async `SPEECH_SYNTHESIZE` -> `GetScenarioArtifactsResponse.output.speech_synthesize.artifacts[]`
- async `IMAGE_GENERATE` -> `GetScenarioArtifactsResponse.output.image_generate.artifacts[]`
- async `VIDEO_GENERATE` -> `GetScenarioArtifactsResponse.output.video_generate.artifacts[]`
- async `MUSIC_GENERATE` -> `GetScenarioArtifactsResponse.output.music_generate.artifacts[]`
- stream text delta -> `ScenarioStreamDelta.text.text`
- stream reasoning delta -> `ScenarioStreamDelta.reasoning.text`
- stream artifact delta -> `ScenarioStreamDelta.artifact.{chunk,mime_type}`

约束：

- `ScenarioOutput` 必须作为稳定 product output 的唯一 oneof 容器；sync 路径挂在 `ExecuteScenarioResponse.output`，async artifact/job 路径挂在 `GetScenarioArtifactsResponse.output`。不得要求 SDK/app 通过 `Struct.fields.*`、artifact bytes、或 MIME 约定猜测字段语义。
- `TEXT_GENERATE` 请求中的 reasoning 配置必须使用 typed `TextGenerateScenarioSpec.reasoning`，至少覆盖 `mode`、`trace_mode`、`budget_tokens`；legacy/缺省请求保持 `OFF + HIDE` 语义，不得因模型默认值漂移破坏旧客户端。
- `ScenarioStreamDelta` 必须使用显式 oneof 分支表达 text/reasoning/artifact；不得再混用自由字段或让消费方根据场景类型推断 delta 语义。
- provider 若不支持请求的 reasoning 开关、独立 trace 或 budget，必须 fail-close；不得把 reasoning 静默并入正文、伪造空 trace，或在 stable surface 上假装成功。
- text stream timeout 语义必须拆分为首包超时、空闲超时和绝对上限；reasoning/text/tool/usage 增量都应视为 activity 并刷新 idle timer，但单纯 started 事件不构成有效进展。
- `google.protobuf.Struct` 仅允许保留在 workflow/internal explicit-dynamic envelope 等非稳定 product surface，不得继续作为 text/embed/stt/image/video/music 等高频 app-facing 能力的事实源。
- SDK/desktop/relay 的高层 helper 必须直接消费这些 typed output/delta，不得把稳定 protobuf message 重新降格为 `Record<string, unknown>` 再解析。
## K-MMPROV-038 Native-Binary Managed Backend Contract

- For `backend_class=native_binary`, runtime may materialize profiles privately, but execution must terminate at the managed image backend gRPC contract and may not call llama `/models/import`.
- `POST /v1/media/image/generate` is still the only canonical app-facing execution surface; callers must never observe a second image control-plane API.
- If `proxy_execution` cannot connect the request to the managed image backend direct contract, it must fail-close instead of forwarding through llama or any legacy management route.
- Supported native-binary tuples may be backed by a runtime-owned package entrypoint or a runtime-owned wrapper around the published backend binary, but both variants must preserve the same managed image backend gRPC contract and fail-close semantics.
- Package-source selection inside the managed native-binary path is runtime-private. Choosing a canonical or experimental package source must not change the public request path, response envelope, or any app-visible provider/model contract.
- Unsupported managed-image package tuples must fail-close before provider execution begins, using `AI_LOCAL_MODEL_UNAVAILABLE` rather than a generic provider internal error.

---

<!-- source: .nimi/spec/runtime/kernel/nimillm-contract.md -->

# Runtime nimiLLM Contract

> Owner Domain: `K-NIMI-*`

## K-NIMI-000 Runtime Target Identity v2 Hard Cut

Outbound nimiLLM execution consumes resolved v2 execution binding and
post-resolve provider facts. Raw durable `model_id` input is not an admitted
execution target and must not be used for prefix/provider validation before
target resolution.

## K-NIMI-001 Module Boundary

nimiLLM 负责 remote 执行适配，不承担 connector 持久化职责。

## K-NIMI-002 Provider Adapter Layering

provider 适配必须分层：请求映射、响应归一化、错误归一化。

## K-NIMI-003 Model Prefix Responsibility

model_id 前缀与 provider 匹配校验必须在进入 provider 出站前完成。

## K-NIMI-004 Media Job Responsibility

媒体任务的提交与查询必须遵循 ScenarioJob 契约，不得绕开 job 元数据语义。

## K-NIMI-005 Endpoint Security Delegation

remote 出站 endpoint 安全校验必须遵循 endpoint-security 约束。

## K-NIMI-006 Streaming Alignment

文本/语音流事件必须遵循 `K-STREAM-*` done/终帧语义。

## K-NIMI-007 Audit Alignment

执行入口、路由决策、错误退出必须写入统一审计字段。

## K-NIMI-008 Route Visibility

routePolicy、backendName、fallback 决策必须可观测。

## K-NIMI-009 Unsupported Modality

不支持的能力必须显式返回 `AI_MODALITY_NOT_SUPPORTED`。

## K-NIMI-010 Availability & Fallback

可用性门控与 fallback 必须显式，禁止静默降级。

---

<!-- source: .nimi/spec/runtime/kernel/provider-health-contract.md -->

# Provider Health Contract

> Owner Domain: `K-PROV-*`

## K-PROV-001 Provider 健康状态机

每个 AI Provider 维护独立健康状态：

| 状态 | 含义 |
|---|---|
| `unknown` | 初始态，从未探测 |
| `healthy` | 最近一次探测成功 |
| `unhealthy` | 最近一次探测失败 |

状态迁移规则：
- `unknown → healthy`：首次探测成功。
- `unknown → unhealthy`：首次探测失败。
- `healthy → unhealthy`：探测失败。连续失败计数从 0 开始递增。
- `unhealthy → healthy`：探测成功。连续失败计数归零。
- 状态变更时更新 `lastChangedAt`；每次探测更新 `lastCheckedAt`。

快照字段：`name`、`state`、`lastReason`、`consecutiveFailures`、`lastChangedAt`、`lastCheckedAt`。

## K-PROV-002 探测目标

Production probe targets are resolved only inside the Runtime service
principal: cloud targets come from Runtime-owned connector/provider records and
opaque custody refs; supervised local targets come from Runtime engine state;
an admitted attached endpoint comes from service-owned typed configuration.
Environment variables, argv, user config, Desktop/SDK/renderer payloads, and
raw keys cannot create or override a production target.

The following environment-name mapping is retained solely for separately
signed synthetic non-product probe fixtures. It cannot be loaded by a
production Runtime or counted as product evidence:

| 探测名称 | Base URL 环境变量 | API Key 环境变量 |
|---|---|---|
| `local` | `NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL` | `NIMI_RUNTIME_LOCAL_LLAMA_API_KEY` |
| `local-image` | daemon-managed image backend (internal attribution only) | n/a |
| `local-media` | `NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL` | `NIMI_RUNTIME_LOCAL_MEDIA_API_KEY` |
| `local-speech` | `NIMI_RUNTIME_LOCAL_SPEECH_BASE_URL` | `NIMI_RUNTIME_LOCAL_SPEECH_API_KEY` |
| `local-sidecar` | `NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL` | `NIMI_RUNTIME_LOCAL_SIDECAR_API_KEY` |
| `cloud-nimillm` | `NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL` | `NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY` |
| `cloud-dashscope` | `NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL` | `NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY` |
| `cloud-volcengine` | `NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL` | `NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY` |
| `cloud-volcengine-openspeech` | `NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_BASE_URL` | `NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY` |
| `cloud-gemini` | `NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL` | `NIMI_RUNTIME_CLOUD_GEMINI_API_KEY` |
| `cloud-minimax` | `NIMI_RUNTIME_CLOUD_MINIMAX_BASE_URL` | `NIMI_RUNTIME_CLOUD_MINIMAX_API_KEY` |
| `cloud-mimo` | `NIMI_RUNTIME_CLOUD_MIMO_BASE_URL` | `NIMI_RUNTIME_CLOUD_MIMO_API_KEY` |
| `cloud-kimi` | `NIMI_RUNTIME_CLOUD_KIMI_BASE_URL` | `NIMI_RUNTIME_CLOUD_KIMI_API_KEY` |
| `cloud-glm` | `NIMI_RUNTIME_CLOUD_GLM_BASE_URL` | `NIMI_RUNTIME_CLOUD_GLM_API_KEY` |
| `cloud-deepseek` | `NIMI_RUNTIME_CLOUD_DEEPSEEK_BASE_URL` | `NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY` |
| `cloud-openrouter` | `NIMI_RUNTIME_CLOUD_OPENROUTER_BASE_URL` | `NIMI_RUNTIME_CLOUD_OPENROUTER_API_KEY` |
| `cloud-openai` | `NIMI_RUNTIME_CLOUD_OPENAI_BASE_URL` | `NIMI_RUNTIME_CLOUD_OPENAI_API_KEY` |
| `cloud-openai-compatible` | `NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_BASE_URL` | `NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_API_KEY` |
| `cloud-openai-codex` | `NIMI_RUNTIME_CLOUD_OPENAI_CODEX_BASE_URL` | `NIMI_RUNTIME_CLOUD_OPENAI_CODEX_API_KEY` |

Only within that non-product fixture posture does a non-empty synthetic Base
URL activate a mapped fixture target. Production activation uses the owner
records above.

本地 provider 补充：

- `local-image` 仅用于 daemon-managed image backend 的健康归因与审计，不从环境变量装配独立 probe target。
- `local-media` 在 `supported_supervised` host 之外不得由 runtime 自动注入默认 loopback probe target。
- 当 host 仅支持 `attached_only` 时，只有 Runtime service-owned typed config
  中 independently admitted 的 endpoint 才参与 provider health 探测；调用方/env
  不能注入。
- `tables/local-image-supervised-backend-matrix.yaml`（v2）是 canonical local image supervised health 归因的唯一平台事实源。health attribution 必须消费 v2 matrix resolver 输出的 `entry_id`、`backend_family`、`backend_class`、`product_state`；不得各自推断。
- `local-media` 的 host support 判断不得只按 public engine=`media` 一刀切；必须由 v2 matrix resolver 输出的 `backend_class` / `backend_family` / `control_plane` / `execution_plane` 驱动。
- `product_state=unsupported` 的 entry 命中时，health 必须返回 recognized-but-unsupported 归因并以 `AI_LOCAL_MODEL_UNAVAILABLE` fail-close。`product_state=proposed` 且 admission 未通过时同理。
- `darwin/arm64` 与 `windows/amd64 + nvidia driver/gpu visible` 上的 daemon-managed `stablediffusion-ggml` supervised probe target 属于正式支持的 canonical image path；provider health 必须直接消费 v2 matrix selection，不得再附加独立的 host-generation 门槛。Windows CUDA user-space runtime readiness 必须由 runtime shared accelerator dependency resolver 归因，并引用 `tables/shared-accelerator-dependencies.yaml` 与 `tables/accelerator-consumer-requirements.yaml`：`materializable_requires_confirmation` / `queued` / `downloading` / `verifying` / `installing` / `failed` / `repair_required` / `cancelled` 均 fail-close，不得返回 healthy；只有 `ready_system` 或 `ready_managed` 可以进入对应 consumer 的 ready health。
- 当 image 资产被 v2 matrix resolver 判定为 `backend_class=native_binary` + `control_plane=runtime` 时，provider health 归因必须落到 runtime-owned image control plane 与其真实受管 backend，不得继续把它视为 attached-only `local-media` 资产并要求外部 endpoint。
- 对 runtime-owned supervised image 资产（`control_plane=runtime`, `execution_plane=media`）：
  - `local-media` probe target仍是 app-facing execution health 的唯一 loopback 事实源。
  - `local-image` 仅用于 daemon-managed image backend 的内部健康归因，不得替代 `local-media` execution probe。
  - health attribution detail 必须带上 `backend_family`、`entry_id`、`internal_reason_key`（K-LENG-017）。
- 对 `backend_class=python_pipeline` 的 runtime-owned image 资产：
  - `local-media` 承担 execution health，runtime 负责 control-plane 归因与状态投影。
  - health attribution detail 必须包含 `backend_family=diffusers`、`entry_id`、`internal_reason_key`。
  - Python runtime / venv 损坏、依赖安装失败等必须以对应 `internal_reason_key` 归因，不得泛化为 generic provider unavailable。
- `local-speech` 作为完整 supervised engine，与 `local` / `local-media` 一样按显式 Base URL 配置参与 provider health 探测。
- `local-speech` 的 canonical provider probe 固定为 `/healthz` → `/v1/catalog`；不得错误回落到 `/v1/models`。
- `local-speech` provider health 只回答 provider-facing reachability 与 canonical provider probe truth；不得被解释为 `audio.synthesize` / `audio.transcribe` capability-route readiness 或 admitted plain-speech success。
- local workflow execution 即使被 admitted，`local-speech` provider health 也仍只回答 provider-facing reachability；workflow-ready 只能由 family-scoped route/host execution proof 回答。
- baseline admitted local workflow family 当前固定为 `qwen3_tts`；其成功不得在 provider health 层被泛化成 generic local workflow healthy。
- route health、model health、asset health 可以消费 provider health 作为 reachability 输入，但不得回写、覆盖、或替代 provider health truth owner。
- `local-media` 的 `/healthz` 必须只在依赖、设备、默认模型与默认管线全部 ready 后返回 `2xx`；不得使用静态 `"ok"` 健康响应伪装就绪。
- v2 观测字段（`backend_family`、`backend_class`、`product_state`、`control_plane`、`execution_plane`）以及任何后续 speech-specific provider detail，本轮只允许落在 runtime-private resolved detail、provider hints `extra`、audit detail；不新增 `AIProviderHealthSnapshot` typed 字段。

## K-PROV-003 探测间隔与策略

> 本协议适用于云端 provider 探测目标（K-PROV-002）。本地引擎健康探测使用 K-LENG-007。

- **基础探测间隔**：service-owned `aiHealthIntervalSeconds`，默认 8s。
- **HTTP 超时**：service-owned `aiHttpTimeoutSeconds`，默认 30s。
- **探测路径**：按序尝试 `/healthz` → `/v1/models`，任一路径返回 `2xx` 即视为健康；`401`/`403`/`429`（server 可达但配置/限流问题）亦视为健康；`404` 触发下一探测路径；其余 `4xx` 与 `5xx` 视为不健康。
- `local-media` 与 `local-speech` 为例外：canonical provider probe 固定为 `/healthz` → `/v1/catalog`。
  - **设计取舍（K-PROV-003）**：`401`/`403` 标记为 healthy 意味着 API key 无效或权限不足的 provider 在健康面板显示"健康"，但该 provider 的所有 AI consume 请求会失败并返回 `UNAVAILABLE + AI_PROVIDER_UNAVAILABLE`（K-ERR-005）。此为有意设计：健康探测回答的是"server 是否可达"，而非"凭据是否有效"。两个信号服务不同用途——健康面板用于网络连通性诊断，consume 错误用于凭据配置诊断。Desktop UI 应在 provider 显示 healthy 但 consume 持续返回 `AI_PROVIDER_UNAVAILABLE` 时，引导用户检查 API key 配置而非网络连通性。
- **探测时机**：daemon 启动后立即执行首次探测，之后按间隔周期性执行。
- **暂停条件**：daemon 处于 `STOPPING`/`STOPPED` 时跳过探测。

## K-PROV-004 Provider 健康与 Runtime 状态联动

- 所有探测目标均不健康时：Runtime 健康降级为 `DEGRADED`（reason: `ai-provider:<name> unavailable`）。
- 任一探测目标恢复健康时：若当前为 AI Provider 原因的 `DEGRADED`，恢复为 `READY`。
- 状态变更时写入审计事件（domain: `runtime.ai`, operation: `provider.health`）。

## K-PROV-005 Provider 名称归一化

配置文件中的 provider 名称仅允许 canonical 值：

- `local`、`llama`、`media`、`sidecar`
- `nimillm`
- `dashscope`
- `volcengine`、`volcengine_openspeech`
- `gemini`
- `minimax`
- `mimo`
- `kimi`
- `glm`
- `deepseek`
- `openrouter`
- `openai`
- `anthropic`
- `openai_compatible`
- `openai_codex`

非 canonical 名称（包含历史 alias 与 legacy 名称）在配置校验时拒绝。

执行命令：

- `pnpm check:runtime-provider-alias-hardcut`

**约束点**：`CreateConnector` / `TestConnector` / `ListConnectorModels` 的 provider 输入必须是 canonical 值；ConnectorService 入口统一校验并拒绝 alias。

Gemini 默认：当配置了 `NIMI_RUNTIME_CLOUD_GEMINI_API_KEY` 且未配置 Base URL 时，自动填充 `https://generativelanguage.googleapis.com/v1beta/openai`。不支持 `GEMINI_API_KEY` fallback。

## K-PROV-006 探测目标与 Provider 类型映射

探测目标（K-PROV-002）与 `provider-capabilities.yaml` 中 provider 类型的对应关系：

| 探测目标 | Provider Type | 说明 |
|---|---|---|
| `local` | `local` | llama 引擎 |
| `local-image` | `local` | daemon-managed image backend attribution target |
| `local-media` | `local` | media 引擎 |
| `local-speech` | `local` | speech 引擎 |
| `local-sidecar` | `local` | Attached music sidecar |
| `cloud-nimillm` | `nimillm` | NimiLLM 代理层 |
| `cloud-dashscope` | `dashscope` | 阿里云 DashScope |
| `cloud-volcengine` | `volcengine` | 字节跳动火山引擎 |
| `cloud-volcengine-openspeech` | `volcengine_openspeech` | 字节跳动开放语音 |
| `cloud-gemini` | `gemini` | Google Gemini |
| `cloud-minimax` | `minimax` | MiniMax |
| `cloud-mimo` | `mimo` | Xiaomi MiMo |
| `cloud-kimi` | `kimi` | Moonshot Kimi |
| `cloud-glm` | `glm` | 智谱 GLM |
| `cloud-deepseek` | `deepseek` | DeepSeek |
| `cloud-openrouter` | `openrouter` | OpenRouter |
| `cloud-openai` | `openai` | OpenAI |
| `cloud-openai-compatible` | `openai_compatible` | OpenAI-compatible endpoint |
| `cloud-openai-codex` | `openai_codex` | OpenAI Codex OAuth endpoint |

`anthropic` 为直连 provider，不经过 Nimi 适配层，无独立探测目标。
## K-PROV-007 Managed Image Health Admission

- `tables/managed-image-backend-packages.yaml` gates whether a recognized `native_binary + stablediffusion-ggml` tuple may ever become healthy.
- When multiple package sources exist for one host tuple, provider health must use the tuple's canonical `product_state=supported` package source by default. Runtime-private experimental package sources must not affect health unless that source was explicitly selected inside runtime configuration.
- If the matrix recognizes the topology but the managed image backend package table marks the tuple unsupported, provider health must report recognized-but-unsupported detail and keep the asset unavailable.
- Health attribution for supported native-binary tuples must be based on the managed image backend gRPC target plus `local-media` execution readiness, not on llama management routes.
