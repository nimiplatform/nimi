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

- `local-category-capability.md` — K-LOCAL-013~015, K-LOCAL-014a (`ResolveProfile`, `ApplyProfile`)
- `device-profile-contract.md` — K-DEV-001~009 (device profile collection)
- `model-service-contract.md` — K-MODEL-001~008 (model descriptor, health check)
- `scheduling-contract.md` — K-SCHED-001~007 (five-state scheduling judgement)
- `key-source-routing.md` — K-KEYSRC-001~011 (remote binding legality)
- `connector-contract.md` — K-CONN-001~017 (connector custody and legality)
- `.nimi/spec/desktop/kernel/ai-profile-config-contract.md` — D-AIPC-001~012 (desktop AI config authority)
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — P-AISC-001~005 (AIScopeRef)
