# AI Profile / Config / Snapshot Desktop Consumption Contract

> Authority: Desktop Kernel

## D-AIPC-000 Runtime Target Identity v2 Hard Cut

Desktop AIProfile/AIConfig consumption uses v2 durable target refs only. Local
`targetId/profileId/localModelId` and cloud `connector_id + provider model_id`
are retired as durable target identity. Desktop may carry `connector_id` only
as remote credential custody after v2 target resolution.

## Scope

定义 Desktop 如何消费 `AIProfile`、`AIConfig`、`AISnapshot` 三段式 AI
配置模型，以及它们与现有 `D-LLM-015 ~ D-LLM-021` conversation capability
authority 的 umbrella 关系。

本契约不是全局 AI 配置 canonical owner。AIConfig intent 归具体 scope /
app owner；Runtime 归 facts、materialization、readiness、route feasibility 与
execution evidence；SDK 归 Desktop / Web / Kit 消费这些 owner truth 的 typed
projection boundary。Desktop 只能作为自身 desktop-resident scopes 的 consumer /
placement owner，不得成为所有 app / module / feature scope 的 host-local
AIConfig owner。

在 desktop surface 中，renderer、chat、settings、Runtime page 等 consumer
只能通过 formal SDK / host projection 消费对应 scope 的 `AIConfig` /
`AISnapshot`。它们不能自持久化平行真相，也不能把 Desktop host-local storage
升级为跨 app 的 canonical AIConfig owner。

Agent Chat orchestration and execution semantics 不由本契约拥有。`AIProfile` /
`AIConfig` / `AISnapshot` 只拥有 AI configuration / execution evidence authority；
Runtime owns Agent Chat turn planning、message/action、voice workflow、media
execution、prompt/context assembly、and Runtime Agent execution projection.
Desktop only consumes those projections through
`agent-chat-projection-contract.md`（`D-LLM-022` ~ `D-LLM-026`）.

## D-AIPC-001 — Three-Tier AI Configuration Authority

AI 配置 authority 固定为三段式，Desktop 只消费和投影该三段式：

1. **`AIProfile`** — 标准配置包 / 预设 / 模板。可下载、导入导出、推荐、probe、模块测试。不直接作为运行时长期真相。
2. **`AIConfig`** — 某个 scope 当前实际生效的 AI intent/config。绑定到
`AIScopeRef`（P-AISC-001）。其 intent owner 是该 scope / app owner；是否可
执行由 Runtime facts/readiness/evidence 判定。
3. **`AISnapshot`** — 每次 turn / job 启动时固化的执行快照 envelope。它包含
scope config evidence 与 Runtime execution evidence slices，是执行期真相。

三者不可互为 fallback：
- `AIProfile` 不能被当作 live config 消费。
- `AIConfig` 不能在执行期间被实时回读替代 snapshot。
- `AISnapshot` 不能回写为 config 或 profile。

## D-AIPC-002 — AIProfile Semantics

`AIProfile` 是 portable 标准配置包，最小语义包含：

- capability slice intent（per canonical capability），每个 slice 必须有稳定
  `slice_id`、`execution_mode`、`contract_state`、required/optional readiness
  policy、默认 params、可编辑字段边界，以及 local 或 cloud connector 的模式化
  binding intent
- generation params（per capability）
- local media / local component source binding intent，包括 main asset、
  component、ordered companion occurrence、manual association requirement、以及
  optional expected integrity
- cloud connector intent，包括 provider/model/capability/credential policy 与
  non-secret connector selector
- policy / style metadata
- profile-level UX metadata（`title`、`description`、`tags`）

`AIProfile` 不包含：

- 具体 `AIScopeRef` 绑定（profile 是 scope-agnostic 模板）
- runtime-local install state / machine-specific asset residency
- concrete install result / dependency resolution result
- device-specific feasibility state / host-specific engine binary path
- live health / availability state
- `RuntimeRouteBinding`、`selectedBindings` runtime evidence、selected source
  records、backend package / Python / Torch / CUDA / accelerator evidence、
  local materialization evidence、workflow binding identity、scheduler state、
  provider health、rate-limit、billing、quota、raw connector secret、token、API
  key、or credential payload

与 Runtime local profile projection 的关系：

- runtime local profile 是 runtime-facing、installable 的 local dependency / execution package。
- 一个 `AIProfile` 可引用、组合或派生出一个或多个 runtime local profile。
- `AIProfile` 与 runtime local profile 不假定一一对应。
- portable profile payload 与 machine-local install state 之间的边界由 D-AIPC-007 定义。
- `targetId/profileId`、`localModelId`、`goRuntimeLocalModelId`、bare
  `asset_id`/`local_asset_id` 这类 pre-v2 local logical refs are retired and
  must not enter `AIProfile` or materialized `AIConfig` as durable target
  identity. Local runtime selection must be expressed through a v2
  `local-runtime` target ref carrying exactly one of `profile_binding_id` or
  `readiness_ref`.

## D-AIPC-003 — AIConfig Semantics

`AIConfig` 是某个 scope 当前实际生效的 consumer-scoped AI 配置：

- 必须绑定到 canonical `AIScopeRef`（P-AISC-001）。
- scope 不限于 app；可为 app / module / feature。
- `AIConfig` 必须是 full materialized config for that scope's declared
  app/module/feature capability requirements — 不允许 partial overlay、scope 间
  fallback chain（P-AISC-003）、placeholder disabled capability、或把未满足的
  required slice 写成 live config。
- `AIConfig` 可与 `AIProfile` 共享 schema subset；区别在于 owner 语义（bound vs template），不在字段形状。
- `AIConfig` 的 canonical persistence / subscription / scope-keyed read-write
  owner 必须是对应 `AIScopeRef` 的 scope / app owner，通过 SDK typed
  projection 暴露给 Desktop。Desktop host 可以为自身 desktop-resident scopes
  提供 placement 与 editing UI，但不得成为其它 app / module / feature scope 的
  canonical persistence owner。

`AIConfig` 内部结构固定包含：

- `scopeRef: AIScopeRef` — 所属 scope identity
- `capabilities` — per-capability configuration（对齐 D-LLM-016 selection store schema，详见 D-AIPC-010）
- `profileOrigin?: AIProfileRef | null` — 最近一次 apply 的 profile 来源（仅用于 UX 溯源展示，不构成 live reference）

`AIConfig.capabilities` 的 admitted live payload 只能包含：

- consumer requirement id / capability id / source profile ref / slice id；
- mode-specific compact runtime target ref:
  - `local-runtime`: v2 durable local target ref only. It must carry
    `version=v2` and exactly one of `profile_binding_id` or `readiness_ref`.
    It must not carry `targetId/profileId`, local model ids, install ids, file
    paths, runtime proof, or materialization evidence.
  - `cloud-connector`: v2 durable cloud target ref only. It must carry
    `connector_id`, `remote_model_catalog_id`, `provider_model_id`, and
    `provider` when available. `connector_id` + provider `model_id` without
    `remote_model_catalog_id` is not an admitted durable binding.
- profile-authored or user-edited params constrained by the slice editable-field
  contract；
- profile origin and content/hash/version evidence needed by the scope owner.

`AIConfig.capabilities` must not persist `RuntimeRouteBinding`,
`selectedBindings` runtime evidence, route endpoints, local paths, selected
source records, dependency selected-source evidence, install/materialization
records, workflow binding ids, backend package/Python/Torch/CUDA details,
provider health, scheduler state, raw connector secret, token, API key, or
credential payload. Runtime may derive those facts during prepare/probe/execute,
but they remain Runtime-owned evidence outside AIConfig.

`AIConfig` 不得把 Agent Chat behavior settings、turn planning、message/action
outputs、voice workflow semantics、or Runtime Agent execution projection 收编为新的
top-level live config truth。若 chat consumer 需要这些 semantics，必须消费 Runtime /
SDK projection；Desktop 不得在本地恢复一套 behavior authority surface。

用户在 scope 内微调时，改的是该 scope 的 `AIConfig`。修改不反向污染 `AIProfile`。修改后 `profileOrigin` 可保留（表示"基于哪个 profile 的自定义"）但不具有 binding 语义。

## D-AIPC-003a — Adjacent Desktop-Host Live Config Surface

并非所有 user-editable 的 scope-owned AI live config 都必须被收编进
`AIConfig.capabilities`。

当某个 live config 同时满足以下条件时，允许作为 scope-owned adjacent config
surface 存在，并通过 SDK / typed host projection 暴露给 Desktop UI：

- 配置是 user-editable、scope-keyed、并需要 durable persistence /
  subscription / read-write authority
- 配置影响的是 runtime-owned bank / substrate / retained-memory behavior，而不是
  普通 turn execution capability truth
- 若把它强行收编进 `ConversationCapabilitySelectionStore` /
  `ConversationCapabilityProjection`，会制造 capability truth 与 runtime bank
  truth 的 owner 混淆

Memory embedding config 被明确 admit 为第一类 adjacent live config surface：

- scope owner 是 editable memory embedding config 的 canonical persistence /
  subscription / read-write owner；Desktop 只拥有其 UI placement 与 typed
  projection consumption
- 该 config 只表达 user intent，例如 `source_kind` 与 binding reference
- 该 config 不拥有 resolved embedding profile、readiness proof、bind result、
  bank identity、migration state、或 cutover result

Desktop consumer 必须通过 typed SDK / host projection surface 读取/写入这类
adjacent live config；不得把 renderer-local state、Desktop-local storage、或
runtime private loopback convenience endpoint 当成正式 live-config owner。

## D-AIPC-004 — AISnapshot Semantics

`AISnapshot` 是每次 turn / job 启动时固化的执行证据：

- `executionId: ULID` — 执行标识
- `scopeRef: AIScopeRef` — 来源 scope
- `configEvidence` — 固化时的 `AIConfig` 快照或其 hash
- `conversationCapabilitySlice` — conversation capability execution evidence（收编自 D-LLM-019 `ConversationExecutionSnapshot`）
- `runtimeEvidence` — 执行时 runtime evidence（nullable），包含：
  - `schedulingJudgement` — scheduling preflight judgement（K-SCHED-001 `SchedulingJudgement`，nullable）。如果 submit path 在 `Acquire` 前执行了 target-scoped `Peek`（K-SCHED-002），其 submit-specific execution target judgement 记录在此。scope aggregate judgement 不得写入这里。
  - 未来可扩展：resolved capability evidence、device profile summary 等。
- `createdAt: ISO8601` — 固化时间

`AISnapshot` 是 execution evidence，不是 recovery path：
- 不用于 fallback 恢复
- 不回写为 config 或 selection store
- 运行中 turn / job 只读自己的 snapshot，不回读 live `AIConfig`
- `runtimeEvidence` 为 null 表示 submit path 未执行 scheduling preflight（如 cloud route 不经过 local scheduler），不是错误
- 若 submit path 只有 scope aggregate feasibility 结果而没有 target-scoped scheduling judgement，则 `runtimeEvidence.schedulingJudgement` 必须保持为 null，不允许用 scope aggregate 充当 execution evidence
- `AISnapshot` 是 owner-sliced execution evidence envelope：scope / app owner
  owns config evidence identity，Runtime owns execution/runtime evidence slices，
  SDK owns typed projection。Desktop consumer 不得自定义 consumer-local
  `AISnapshot` schema 或把 local storage 当成正式 snapshot owner。
- Desktop host `AISnapshot` record/read persistence may consume SDK typed
  storage helpers, but the host surface must not be a renderer-memory-only ring
  buffer in production. A process-memory store is admitted only for explicit
  test/development harnesses and must not be projected as durable execution
  evidence.
- snapshot 若记录 Agent Chat turn / message / action / voice / workflow /
  presentation evidence，也只能记录 Runtime-owned execution evidence slices；
  Desktop consumer 不得在 capture 时重新解析、覆写、或补默认 Agent Chat truth

## D-AIPC-005 — Profile Apply Semantics

用户在某个 scope 中选择 `AIProfile` 时，系统语义固定为：

- 用该 profile 内容**原子覆盖**当前 scope 的 `AIConfig`。
- 不建立对 profile 的长期共享引用。
- apply 不是 merge / partial patch；是 full materialization overwrite。

Apply 原子性规则：
- 要么整个 `AIConfig` materialization 成功，要么保持原 config 不变。
- 不允许 field-level partial commit。
- 并发 apply 需要 scope-level version / CAS 保护。

Apply probe / failure 规则：
- schema invalid → apply 失败，config 不变。
- required app/module/feature capability slice unresolved、runtime unavailable、
  dependency missing、connector credential missing、manual association missing、
  unsupported backend/family、or required source/readiness unmet → apply 失败并
  返回 typed `setup_required_no_live_config` / equivalent no-live-config
  outcome，config 不变。已有 valid AIConfig 必须保留直到 successful apply
  replaces it.
- optional slice unresolved → 该 optional slice 从 live AIConfig omit，并在
  setup-required/optional-unavailable projection 中呈现；不得写入 disabled/null
  placeholder capability。
- 不允许在 apply 时删除失败 capability 字段形成 pseudo-success。
- 不允许 apply-first：profile import、preview、probe、or prepare 未证明 required
  slice readiness 时，不得把 syntactically valid but non-executable config
  写入 live AIConfig。

## D-AIPC-006 — No Global Active Profile

- 不定义 `global active profile`。
- global 层只保留 profile catalog。
- 不允许把所有 scope 的 live config 收口成一个全局单值。
- 每个 scope 独立持有 `AIConfig`，不存在跨 scope 联动 live config 的机制。
- 若某个 consumer 需要“当前正在编辑的 scope”便利状态，该 active-scope orchestration 只能是 consumer-local helper，不能扩展为全局 singleton。

## D-AIPC-007 — Portable Profile Boundary

`AIProfile` portable payload 与 runtime-local state 的边界固定为：

**Portable fields**（可下载、分享、导入导出）：

- capability slice intent: `slice_id`、canonical capability、execution mode、
  contract state、readiness policy、local execution constraints, cloud connector
  constraints, asset/source binding refs, companion occurrence refs, params, and
  editable-field declarations
- generation params
- ordered companion occurrence intent with occurrence id/index, role, order,
  asset binding ref, required policy, weight/options, and applies-to constraints
- portable source binding and manual association requirements, including
  optional expected integrity when authored
- policy / style metadata
- profile-level UX metadata（`title` / `description` / `tags`）

**Non-portable fields**（不进入 portable profile payload）：

- local file path
- machine-specific asset residency state
- concrete install result
- device-specific feasibility state
- host-specific engine binary / dependency resolution result
- live health / probe result
- runtime route binding shape (`RuntimeRouteBinding` or equivalent endpoint /
  localModelId / goRuntime* / providerHints fields)
- live `selectedBindings` runtime evidence or reverse-copied AIConfig binding
- selected source records, observed integrity evidence, source access proof,
  HF auth/gated/terms result, manual import local path, transfer/job state
- local materialization records, workflow binding id, prepared asset id,
  scheduler/queue state, provider health/quota/rate-limit evidence
- connector secrets, tokens, API keys, OAuth payloads, or credential material

portable payload 的目标是：任何 profile 可在不同设备间迁移，接收端通过 runtime probe 独立判断可执行性。

Live-config-to-profile export is allowed only through a portable-intent
projection filter. The filter may copy profile refs, slice ids, editable params,
and admitted compact logical refs, but must drop or fail closed on any
RuntimeRouteBinding-like, selected-source, install, path, materialization,
provider-health, scheduler, or credential evidence. A direct copy of live
AIConfig.capabilities into AIProfile.capabilities is forbidden.

## D-AIPC-008 — imageProfileRef Retirement

`imageProfileRef` 不再作为顶层产品概念独立存在，也不得被替换为
localProfileRef-only image config：

- `ConversationCapabilitySelectionStore.defaultRefs.imageProfileRef` 在 `AIConfig`
  体系下收编为 `AIConfig.capabilities` 中 image-related capability 的
  workflow/capability slice binding intent。
- image 相关的 runtime local profile 需求下沉为 `AIProfile` capability slice /
  runtime-facing descriptor / Runtime prepare-readiness-materialization boundary，
  live `AIConfig` 只保存 compact logical refs and params。
- Desktop 用户不再面对"AI profile + 单独 image profile ref"双心智。

迁移规则：
- 现有 `imageProfileRef` 值只能迁移到 admitted image workflow slice ref、
  source profile ref、and mode-specific v2 compact runtime target ref. Any
  `localProfileRef`/`targetId/profileId` shape must be replaced by the
  D-AIPC-003 `local-runtime` v2 target-ref grammar before commit.
- 迁移后 `defaultRefs.imageProfileRef` 从 selection store 中移除。
- 此为 hard cut，不保留兼容层。

## D-AIPC-009 — Snapshot Boundary

- 不做 session 级永久绑定。
- 只在每次 turn / job 启动时生成 `AISnapshot`。
- live `AIConfig` 的后续修改：
  - 影响后续新 turn / 新 job。
  - 不影响已启动 execution 的 snapshot。
- 长任务、流式任务、本地模型任务的配置稳定性由 snapshot 固化保证。

## D-AIPC-010 — Umbrella Authority Over Conversation Capability Model

`AIProfile / AIConfig / AISnapshot` 是 conversation capability 四层 authority（D-LLM-015 ~ D-LLM-021）的 umbrella authority：

- 现有四层不被 supersede 或重命名；它们作为 `AIConfig` / `AISnapshot` 下的 conversation-capability submodel 保留。
- 不允许"旧四层 + 新三层"并列 owner — 四层是 AIConfig/AISnapshot 的 submodel，不是独立 peer authority。
- `agent-chat-projection-contract.md`（`D-LLM-022` ~ `D-LLM-026`）不属于本 umbrella
  收编对象；projection contract 与本契约是相邻 authority，边界固定为
  config/capability truth vs Desktop presentation/projection truth

迁移映射固定为：

| Existing rule | Current owner | Target mapping |
| --- | --- | --- |
| D-LLM-015 Authority Map And Bootstrap Home | capability 四层 authority | 保留 shared builder 约束，将其降为 `AIConfig` 下的 conversation-capability submodel |
| D-LLM-016 Selection Store Semantics | `ConversationCapabilitySelectionStore` | 迁移为 `AIConfig.capabilities` 的 selection 子结构；store schema 保持兼容但 owner 语义归属 `AIConfig` |
| D-LLM-017 Conversation Capability Projection | derived read model | 保留为 `AIConfig` 的派生 projection 层；projection 语义不丢失 |
| D-LLM-018 Agent Effective Capability Resolution | `text.generate` overlay | 保留为 projection 上的 agent overlay；语义不丢失 |
| D-LLM-019 Conversation Execution Snapshot | execution evidence | 收编为 `AISnapshot.conversationCapabilitySlice`；field-level 对齐 |
| D-LLM-020 Voice Workflow Capability Semantics | capability-specific invariant | 原样保留，作为 `AIConfig.capabilities` 下的 voice workflow 专门规则 |
| D-LLM-021 RuntimeFields And Runtime Config Boundary | runtimeFields boundary | 原样保留，防止 `AIConfig` 退化成 `runtimeFields` 替身 |

## D-AIPC-011 — Mutation Rules

### Profile catalog edit

- 编辑 `AIProfile` 本体只影响未来再次 apply 的行为。
- 不自动回写已存在的 `AIConfig`。

### Local customization

- 用户在 scope 内调整模型、companion、params 只改该 scope 的 `AIConfig`。
- 不反向污染 `AIProfile`。
- 自定义修改后 `AIConfig` 仍保持 full materialized，不退回 profile 引用模式。

### Scope ownership and bridge

- Scope / app owner 必须对其 canonical scopes 提供统一的 AIConfig authority
  surface，并通过 SDK / host projection 暴露给 Desktop。
- Desktop-resident scopes 可以由 Desktop product surface 提供 editing placement，
  但 chat、settings 等 consumer 仍只能作为 projection consumer，不得各自持有
  独立 persistence owner。

## D-AIPC-012 — Runtime Probe Taxonomy

profile 与 config 的 probe 分为三类：

1. **Static schema probe** — 检查 profile / config 的 schema 合法性，无需 runtime 在线。
2. **Runtime availability probe** — 检查所需 runtime 路由 / provider / engine 是否在线可用，需要 `runtime.route.checkHealth`。
3. **Resource feasibility probe** — 检查设备资源是否足以执行（VRAM、disk、concurrent slot）。Desktop 在这里固定区分两个 evaluation unit：
   - **scope aggregate**：`probeFeasibility(scopeRef)` 消费 runtime `Peek`（K-SCHED-002）的 aggregate judgement，对当前 scope 中所有 relevant local scheduling targets 做聚合，并在 `AIConfigProbeResult.schedulingJudgement` 中传递该 aggregate scheduling state（K-SCHED-001）。
   - **submit target**：submit guard / execution snapshot capture 必须消费当前 submit target 的 scheduling evaluation；它不是 `probeFeasibility(scopeRef)` 的同义重用。

当 runtime `Peek` 不可用时，`schedulingJudgement` 为 null，`status` 回退为 `degraded`。

约束：

- `probeFeasibility(scopeRef)` 是 scope aggregate surface，不是 submit-time authoritative execution truth。
- Desktop 必须区分 scope aggregate 与 submit-target scheduling evaluation；不允许继续用单个 primary local profile 同时代表这两种语义。
- aggregate `unknown` 不得在 UI 或 submit 逻辑中被伪装成 `runnable`。
- 上述 probe taxonomy 适用于 canonical desktop scopes；consumer 不得绕过 formal AIConfig surface，直接把 raw runtime route / scheduler low-level API 升格为 product-facing probe owner。

UI 必须根据 probe 类别展示对应级别的状态信息。不允许将不同类别的 probe failure 混为同一个 generic "unavailable" 标签。当 `schedulingJudgement` 可用时，UI 应展示 scheduling state 的具体含义（queue、slowdown、denied），而不是仅展示 aggregate `status`。

## D-AIPC-013 — Built-In First-Run AIConfig Evidence

First-run built-in `AIConfig` materialization for `desktop.chat.nimi` and
`desktop.chat.agent` is owned by the scope owner for those Desktop chat scopes
and committed through the SDK / Runtime materialization boundary defined by
`P-AISC-006`, `P-AIPS-*`, and Runtime readiness contracts. Desktop host is the
placement surface, not the global writer authority.

`MUST`:

- first-run must apply the selected local baseline factory `AIProfile` to both
  canonical chat scopes through `D-AIPC-005` atomic apply semantics only after
  required slice readiness/apply eligibility has been proven for each consumer
  requirement
- each built-in config evidence item must bind the exact canonical
  `scopeRef`, the applied `AIProfile` ref / hash, the committed `AIConfig`
  version or content hash, the responsible scope owner / SDK writer identity,
  and `committedAt`
- `builtInAiConfigRefs` in `~/.nimi/nimi.json` must contain backend-verifiable
  durable refs for both required scopes; the refs are valid only when the host
  SDK Runtime / Kit projection can resolve them to committed full materialized
  configs and Runtime execution evidence proof for those exact scopes
- apply or verification failure for either required scope fails first-run
  finalization closed; no partial built-in chat set may enter `ready_for_use`

`MUST NOT`:

- renderer-local state, localStorage, route health, current tab selection,
  conversation state, or string-only `scopeRef` values may serve as readiness
  truth for built-in AIConfig evidence
- Desktop may not derive built-in AIConfig bindings from `runtimeBaselineRef`
  activation consumers, `executionEvidenceRef` payload fields, route health, or
  RuntimeRouteBinding-shaped selected binding projection. Runtime evidence refs
  may verify readiness and built-in admission, but the committed AIConfig must
  contain only compact slice refs and params allowed by D-AIPC-003.
- first-run may not commit a placeholder or syntactically valid but unready
  AIConfig for either required chat scope; failure projects setup-required /
  no-live-config and fails finalization closed.
- `desktop.chat.nimi` and `desktop.chat.agent` may not share a generic fallback
  chat scope, inherit config from one another, or be represented by a single
  global active profile
- built-in first-run config may not hardcode provider, connector, engine, or
  model identifiers outside the admitted `AIProfile` / `AIConfig` authority

## D-AIPC-014 — Profile Apply Preview Semantics

`D-AIPC-005` 的 atomic apply 是 **commit**。在 commit 之前，系统必须支持一个
显式、非提交的 **apply preview**：对给定 `scopeRef` + `AIProfile`，计算如果执行
`D-AIPC-005` apply 会产生的 typed before→after `AIConfig` diff，并返回给 UI 供用户
确认。

Apply preview 与 commit 是两个独立步骤：

- preview 只计算并返回 diff，不写入任何真相。
- commit 仍然是 `D-AIPC-005` 定义的 atomic apply，是一个单独的显式调用。
- preview 不是 commit 的前置必经步骤，但产品 Runtime Ordinary Tasks 要求"先 preview
  再 apply"的 UX；preview 本身不隐式触发、也不排队 commit。

Preview 计算语义：

- preview 的 `after` 必须反映与 `D-AIPC-005` commit **完全一致**的 full
  materialization overwrite 语义 — 是 overwrite，不是 merge / partial patch。
  preview 与后续 commit 之间若使用同一 profile 版本与同一 config base version，
  产出的 `after` 必须与 commit 实际写入的 `AIConfig` 等价。
- 若 required slice readiness/apply eligibility 不满足，preview 必须返回 typed
  setup-required/no-live-config outcome，而不是构造一个不可提交的 placeholder
  `after`。此时可包含 prospective diff only as explanatory projection, but it
  is not an `after` config and must not be passed to commit.
- `before` 是 preview 计算时该 `scopeRef` 的当前 `AIConfig`。若 scope 当前没有
  `AIConfig`（首次 apply），`before` 为显式 `null`，diff 表示 full creation。
- diff 必须是 typed before→after 结构，覆盖 `capabilities`、`profileOrigin`、以及
  其他 `AIConfig` materialized 字段；不允许只返回 free-form 文本摘要或 partial
  字段子集。
- preview 必须在产出的 base version 上携带它所基于的 config version / content
  hash，使 commit 端可以判断 preview 是否仍然 fresh（与 `D-AIPC-005` 并发 apply 的
  CAS 保护对齐）。

Preview 隔离规则（`MUST NOT`）：

- preview 不得 mutate、persist、或以任何方式改变 scope 的 live `AIConfig`。
- preview 不得通知 `D-AIPC-005` / `S-AICONF-006` 的 subscriber，不得触发
  `ConversationCapabilityProjection` 重算。
- preview 不得生成或回写 `AISnapshot`。
- preview 不得修改 `AIProfile` 本体或 catalog。

Preview 失败规则（fail closed）：

- 若目标 `AIProfile` 或当前 `AIConfig` base 是 schema invalid，preview 必须
  fail closed 返回 typed error，不得发出 partial diff 或被截断的 `after`。
- preview 可附带 runtime availability / resource feasibility 的 probe / 可执行性
  warning（对齐 `D-AIPC-012` 的 probe taxonomy）；这些 warning 不阻止 preview
  返回 diff，但 commit 后的 config 是否可执行仍由 `D-AIPC-005` 的 probe 规则约束。
- 当 warning 属于 required slice readiness/apply eligibility blocker 时，它必须
  被升级为 setup-required/no-live-config outcome；不得留作 advisory warning 后
  继续生成 live-config `after`。
- preview 不得通过删除失败 capability 字段制造 pseudo-success 的 `after`。

Preview 与 commit 之间发生的 live `AIConfig` 变更（其他 apply / update）会使
preview 的 base version 过期；此时 commit 端必须依据 `D-AIPC-005` 的 scope-level
version / CAS 保护处理，不允许把过期 preview 的 `after` 当作权威 commit 输入。
preview 自身不持有锁，也不冻结 scope。

本规则适用于 canonical desktop scopes；apply preview 必须经过 SDK / host
projection exposed by the scope owner，不得自定义 local preview 真相。

## Fact Sources

- `agent-chat-projection-contract.md` — D-LLM-022 ~ D-LLM-026 Desktop Agent Chat projection boundary
- `conversation-capability-contract.md` — D-LLM-015 ~ D-LLM-021 conversation capability submodel rules
- `llm-adapter-contract.md` — Desktop provider adaptation and routing rules
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — P-AISC-001 ~ P-AISC-006 AIScopeRef identity contract
- `.nimi/spec/runtime/kernel/scheduling-contract.md` — K-SCHED-001 ~ K-SCHED-007 scheduling judgement contract
