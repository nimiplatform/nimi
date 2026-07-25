# Desktop AI Consumption Rationale

> 本文为 rationale/历史散文，非规范权威；规范 = `.nimi/spec/desktop/ai-consumption.authority.yaml`。

## Rationale 完整性对账

### 已收录

- AI profile/config：旧 `D-AIPC-000` 的 v2 target hard cut 收录为 `rule.nimi.desktop.ai-consumption.r001`；Scope 与三段式 owner boundary 收录为 `r002..r003`。
- `D-AIPC-002` 的 portable profile slice、排除项与 Runtime local profile 非一一对应边界收录为 `r004..r006`；`D-AIPC-003` 的 full scope config、envelope、compact refs、Runtime evidence 排除与 Agent Chat non-owner 收录为 `r007..r011`。
- `D-AIPC-003a` adjacent live config 与 memory embedding config 边界收录为 `r012..r013`；`D-AIPC-004` snapshot envelope、immutability 与 durability 收录为 `r014..r016`。
- `D-AIPC-005..011` 的 atomic apply、readiness、no-global、portable export、imageProfileRef hard cut、per-execution snapshot、conversation capability umbrella 与 mutation semantics 收录为 `r017..r026`。
- `D-AIPC-012` probe taxonomy 与 aggregate/submit-target split 收录为 `r027..r029`；`D-AIPC-013` first-run built-in configs 收录为 `r030..r032`；`D-AIPC-014` typed preview、隔离与 CAS freshness 收录为 `r033..r035`。
- LLM adapter：旧 `D-LLM-001` provider adaptation 与 runtime-only cloud boundary 收录为 `r036..r038`；`D-LLM-002` route fail-close 与 Runtime Agent owner 收录为 `r039..r041`；`D-LLM-003` credential custody 收录为 `r042`。
- `D-LLM-004` local health authority 收录为 `r043..r044`；`D-LLM-005` typed speech surface、独立 voice route 与 Agent voice non-owner 收录为 `r045..r047`；`D-LLM-006` audit projection 收录为 `r048`；`D-LLM-008` trace continuity 收录为 `r049`；`D-LLM-065` world runtime-only boundary 收录为 `r050`。
- Streaming：旧 `D-STRM-001` lifecycle 与 Agent output non-owner 收录为 `r051..r052`；`D-STRM-002` buffering、typing、chunk 与 first-chunk UX 收录为 `r053..r054`；`D-STRM-003..004` interruption、retry 与 cancel 收录为 `r055..r057`。
- `D-STRM-005` ScenarioJob event/terminal semantics 收录为 `r058..r060`；`D-STRM-006` timeout alignment 收录为 `r061`；`D-STRM-007..008` Mode C/D current boundary 收录为 `r062..r064`；`D-STRM-009` backpressure 收录为 `r065`；`D-STRM-010` bounded job recovery/cancel/artifact/connector semantics 收录为 `r066..r068`；`D-STRM-011` PresentationTimeline boundary 收录为 `r069..r070`。
- 两组内嵌机器数据已降级到 `config/desktop-ai-consumption-llm-adapter.yaml` 与 `config/desktop-ai-consumption-streaming.yaml`；它们保存 speech operation catalog、renderer audit enums、timeout rows、job terminal rows 与 disconnect polling 参数，均非产品权威。
- 下文完整保留三份旧契约散文并重接现行 canonical 路径，供设计理由、取舍与逐句核对使用；现行容器共 3 个 definition 与 70 个 rule。

### 缺失

- 第一轮成文后逐句对账发现 snapshot 中 scope aggregate judgement 不得冒充 submit-target evidence 的细节容易被 probe 总结吞掉，已在 `r028` 明确补齐。
- 第一轮成文后逐句对账发现 `connector_id` 既是 credential handle 又不得单独构成 durable target identity 的双重边界容易被拆散，已在 `r001` 与 `r036` 双侧补齐。
- 第一轮成文后逐句对账发现 user cancellation、daemon/resource cancellation 与 backpressure cancellation 的三类 UI 结果不能合并，已在 `r057`、`r064`、`r065` 分别补齐。
- 第一轮成文后逐句对账发现 ScenarioJob cancel ACK 不等于 `CANCELED` 且 artifact 只能在 `COMPLETED` 后读取，已在 `r067` 补齐。
- 补齐后缺失：无。

### 有意拒绝

- 旧 `D-LLM-007` 的固定跨层 gate 顺序、具体 gate ID 与 E2E 排障流程属于开发过程治理，不准入产品 authority；Runtime/SDK/Desktop owner hardcut 已由 `r038..r041` 保留。
- 旧文中的具体 `pnpm` 检查命令、`tables/rule-evidence.yaml` 指针、Phase 2 待办与未来补规则说明均不准入；它们不是当前产品行为。
- Runtime provider 周期探测的默认 8 秒间隔属于 Runtime owner，不在 Desktop 复制第二份 timeout authority；Desktop 只保留 on-demand health consumer 边界。
- 示例中文错误句、等待文案、进度估算措辞与固定标签不准入；现行规则保留 typed terminal state、retry posture、timeout bound 与 fail-closed semantics，config 只保存符号化 machine posture。
- `D-AIPC-010` 的旧 ID 迁移表作为历史映射留在本文，不作为 canonical machine registry；`r025` 保留现行 umbrella ownership。
- Renderer-local profile/config/snapshot persistence、provider factory、direct provider HTTP、local Agent kernel、implicit stream replay、job stream action authority、broad event timeline bypass 与任何 pseudo-success fallback 均拒绝准入。

## Normative migration dispositions

- `.nimi/spec/desktop/ai-consumption.authority.yaml` 是三簇现行唯一 Desktop product authority；历史 `D-AIPC-*`、`D-LLM-*`、`D-STRM-*` 仅作为本文 rationale anchors。
- `config/desktop-ai-consumption-llm-adapter.yaml` 与 `config/desktop-ai-consumption-streaming.yaml` 是 gates、tests 与 implementation audits 可消费的非权威 machine config；canonical rules 决定 ownership、wire boundary、timeouts、terminal semantics 与 fail-closed behavior。
- Conversation capability presentation 继续由 `.nimi/spec/desktop/agent-projection.authority.yaml` 拥有；AIConfig/AISnapshot umbrella 与 Desktop adaptation/stream mechanics 由本容器拥有，不形成并列真相。
- Runtime health、route、credential、stream、job、timeline、Agent execution 与 audit truth 仍由各自 Runtime/SDK owner 提供；本文保留的旧跨层引用只解释设计来源，不授予 Desktop 上游 authority。

## Preserved source: AI Profile / Config / Snapshot Desktop Consumption Contract

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
`.nimi/spec/desktop/agent-projection.authority.yaml`（`D-LLM-022` ~ `D-LLM-026`）.

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
- `.nimi/spec/desktop/agent-projection.authority.yaml`（`D-LLM-022` ~ `D-LLM-026`）不属于本 umbrella
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
- `builtInAiConfigRefs` in `<runtime_owner_state_root>/nimi.json` must contain backend-verifiable
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

- `.nimi/spec/desktop/agent-projection.authority.yaml` — D-LLM-022 ~ D-LLM-026 Desktop Agent Chat projection boundary
- `.nimi/spec/desktop/agent-projection.authority.yaml` — D-LLM-015 ~ D-LLM-021 conversation capability submodel rules
- `.nimi/spec/desktop/ai-consumption.authority.yaml` — Desktop provider adaptation and routing rules
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — P-AISC-001 ~ P-AISC-006 AIScopeRef identity contract
- `.nimi/spec/runtime/kernel/scheduling-contract.md` — K-SCHED-001 ~ K-SCHED-007 scheduling judgement contract

## Preserved source: LLM Adapter Contract

# LLM Adapter Contract

> Authority: Desktop Kernel

## Scope

Desktop LLM 适配器契约。定义 provider 适配、路由策略、Connector 凭据路由、以及 runtime-aligned text/media/voice 集成边界。

## D-LLM-001 — Provider 适配层

LLM 请求通过 provider 适配层路由，对齐 K-KEYSRC-001 两路径模型：

- **managed 路径**（`connector_id` 存在）：通过 ConnectorService 解析 provider / endpoint / credential（K-KEYSRC-009）。`connector_id` 由用户在 Runtime Config UI 选择 connector 后写入运行时字段。
- **inline 路径**（Phase 2，K-KEYSRC-001 inline metadata）：Desktop Phase 1 不使用 inline 路径。
- `provider` 字段仍用于 UI 展示和路由选择，但执行层凭据注入由 `connector_id` 驱动。Runtime K-PROV-005 定义 provider 归一化映射（provider 名称到 ProviderType 枚举的规范化），Desktop 应使用归一化后的 provider 名称发送请求，确保 Runtime 侧正确路由。
- `runtimeModelType` 指定模型能力类型（chat、image、video、tts、stt、embedding）。
- `localProviderEndpoint` / `localProviderModel`：本地引擎绑定；endpoint 允许为空，空值表示当前 route 未配置本地 endpoint。
- `localOpenAiEndpoint`：OpenAI 兼容端点；允许为空，空值表示 runtime 未提供 OpenAI-compatible local binding。

cloud connector 路径必须保持 runtime-only：Desktop 不得恢复 legacy provider adapter factory 或直接 provider `listModels` / `healthCheck` 调用来旁路 Runtime。

执行命令：

- `pnpm check:desktop-cloud-runtime-only`

**跨层引用**：K-KEYSRC-001、K-KEYSRC-009、K-PROV-005。

## D-LLM-002 — 路由策略

执行内核 turn 路由：

- Desktop core product 不拥有 Agent chat route API，也不得在 DataSync / launcher / fallback policy 中内建 Agent 聊天路由。
- `data-api.core.agent.chat.route.resolve` 必须 fail-close：缺少 `agentId`、控制面请求失败、或返回 payload 非法时直接报错；Desktop host 不得合成本地 `LOCAL/AGENT_LOCAL` 成功路由。
- Agent Chat 的 binding/readiness truth 是 Runtime Agent AI Config（K-AGCORE-144~150，经 D-LLM-018 carve-out 消费）；setup / submit / runtime 不得各自重算一份 agent route truth。历史 `AgentEffectiveCapabilityResolution` overlay 已退役。
- Desktop LLM execution adapter 必须消费 SDK route facade 返回的 resolved route
  projection；不得从 provider/model/endpoint/runtimeFields/connector 默认模型
  重新推断 `source`、engine、resolved model id、warm candidate、或 fallback policy。
- Agent Chat turn execution 必须通过 Runtime Agent APIs / SDK projection；Desktop
  不得封装本地 kernel turn 请求、拼装 prompt、合成 state delta / memory
  writes / audit events、或用本地 mode 枚举替代 Runtime turn truth。

## D-LLM-003 — Connector 凭据路由

AI 请求的凭据通过 `connector_id` 路由（K-KEYSRC-001 managed 路径）：

- 用户在 Runtime Config UI 选择 connector → `connector_id` 存入运行时字段 → SDK 请求 body 传递 `connectorId`（S-TRANSPORT-002）。
- Runtime ConnectorService 在 K-KEYSRC-004 step 5~6 加载 connector 并解密凭据注入执行上下文。
- Desktop renderer 全程不接触原始凭据，凭据安全策略由 `D-SEC-009` 定义。
- `credentialRefId` 概念废弃，统一使用 `connector_id`。

**跨层引用**：K-KEYSRC-001~004、K-CONN-001（.nimi/spec/runtime/connector.md）。

## D-LLM-004 — 本地 LLM 健康检查

`checkLocalLlmHealth` 验证本地引擎可用性：

- 对 local `text.generate` / `text.embed`，必须先解析到 `RuntimeLocalService` authoritative local model record；health/status/readiness 以 runtime local model list/status 为真源。
- host-local snapshot、推荐 feed、或 route config 中残留的 `localProviderModel` 只可补充展示元数据，不得单独构成 healthy/sendable 结论。
- local text 路径中，`goRuntimeStatus in {active, installed}` 可视为可执行或可 warm-on-demand；`degraded / unavailable / unhealthy / removed / missing` 必须 fail-close 为 unreachable。
- local `llama` text 健康检查不得仅靠 `GET /v1/models` 2xx 判定 healthy。
- media / speech 路径继续遵循各自的 canonical endpoint 探测协议。
- 返回健康状态用于 UI 指示。

**与 Runtime 健康监测的关系**：Desktop `checkLocalLlmHealth` 是按需调用的即时检查（用户触发或 UI 渲染时），返回瞬时快照。对 local text，它消费 runtime authoritative local model state，而不是复制一套 host-side probe truth；对 media/speech，它仍遵循 `K-LENG-007` 的 engine-specific 协议进行 endpoint 探测。缺 endpoint 或缺 runtime authoritative local record 时必须直接视为未配置/不可达，不得伪造 loopback fallback。Runtime 端有两种持久探测机制：K-LENG-007（本地引擎健康探测）和 K-PROV-003（云端 provider 周期性探测，默认 8s 间隔）。Desktop 即时检查与 Runtime 持久探测互补：Desktop 端驱动 UI 反馈，Runtime 端驱动路由降级和审计事件。

**跨层引用**：K-LENG-007（本地引擎健康探测协议）、K-PROV-001（健康状态机）。

## D-LLM-005 — 语音引擎集成

Desktop 不再持有独立 speech engine facade。语音能力必须通过 SDK
Runtime media projection 消费；Desktop 只负责把用户交互、播放反馈和
Runtime-projected voice capability 状态呈现到对应 UI。

公开 surface 固定为：
- `runtime.media.tts.list.voices`
- `runtime.media.tts.synthesize`
- `runtime.media.tts.stream`
- `runtime.media.stt.transcribe`

选路规则固定为：
- `audio.synthesize`：先走 `runtime.route.listOptions({ capability: 'audio.synthesize' })` 选 binding，再调用 `runtime.media.tts.listVoices/synthesize/stream`
- `voice_workflow.voice_clone|voice_workflow.voice_design`：必须对对应 capability 独立执行 `runtime.route.listOptions -> resolve -> checkHealth -> describe`，再提交 runtime media job；不得复用 `audio.synthesize` 的 route truth
- 缺有效 binding 或缺 route-resolved model 时必须 fail-close，不得返回空 voice 列表作为静默 fallback
- AI Chat、Agent Chat、Runtime Config 对 text/audio/voice workflow 的 capability projection 必须共用 `.nimi/spec/desktop/agent-projection.authority.yaml`（`D-LLM-015` ~ `D-LLM-021`）规定的 shared builder，不得在本地 heuristic 中重建 route metadata truth
- 本契约只拥有 runtime-aligned voice route/API projection。Agent Chat voice
  workflow admission、voice identity、workflow return path、resolved voice action
  execution、playback-ready outcome、broader voice session、transcript/caption
  semantics 均为 Runtime-owned Agent Chat / Voice projection truth。Desktop may
  render those projections but must not execute or derive them locally.

## D-LLM-006 — 本地 AI 推理审计

`LocalRuntimeInferenceAuditPayload` 记录推理事件：

- `eventType`：`inference_invoked` / `inference_failed` / `fallback_to_cloud`（映射到 Runtime 审计字段 `operation`）
- `source`：`local` / `cloud`（映射到 Runtime 审计载荷 `payload.source`）
- `modality`：`chat` / `image` / `video` / `tts` / `stt` / `embedding`
- `adapter`：`openai_compat_adapter` / `llama_native_adapter` / `media_native_adapter` / `media_diffusers_adapter` / `sidecar_music_adapter`
- `policyGate`：策略门控信息

**审计角色定位**：Desktop `LocalRuntimeInferenceAuditPayload` 是**展示层补充审计记录**，用于 UI 侧的推理事件追踪和本地调试。它不替代 Runtime 层的持久化审计：

- **Runtime K-AUDIT-001**（全局审计最小字段）和 **K-LOCAL-016**（本地审计）由 daemon 层写入，包含完整的 `request_id`、`trace_id`、`user_id`、`usage` 等运行时上下文字段。
- **Desktop D-LLM-006** 侧重于记录 renderer 可观测的推理决策信息（eventType、source、adapter、policyGate），不具备 runtime 上下文字段。
- 两者通过 SDK `RuntimeLocalService.AppendInferenceAudit` 桥接：Desktop 将审计载荷提交到 runtime，最终存入 Runtime 审计存储。

## D-LLM-007 — 分层调试责任与门禁顺序

Desktop 调试必须遵循固定分层门禁顺序：

- Runtime gate（K-GATE-040/K-GATE-060/K-GATE-070）未通过时，SDK 与 Desktop 不得以 workaround 继续推进。
- SDK gate（S-GATE-020/S-GATE-080/S-GATE-090）未通过时，Desktop 只能修复 SDK 对接问题，不得在 Desktop 侧 hardcode 补洞。
- Desktop 仅在 Runtime+SDK 双绿灯后进入 E2E 排障。

禁止路径：

- 以 legacy 接口或 hardcode provider/model/route 规避上游未收敛问题。
- 在 Desktop 侧复制 Runtime/SDK 的路由或能力判定逻辑。

跨层引用：K-GATE-040、K-GATE-060、K-GATE-070、S-GATE-080、S-GATE-090。

## D-LLM-008 — Trace 连续性

LLM 适配器必须在跨模态链路保持统一 trace：

- 对外返回统一 `traceId`（text/image/video/stt/embedding/speech）；`promptTraceId` 仅作为文本兼容字段并与 `traceId` 语义对齐。
- Runtime 未返回 trace 时，Desktop 执行层必须生成可追踪 fallback trace，避免断链。
- 推理审计载荷必须包含 `traceId + modality + routeSource + reasonCode`，确保 Runtime↔SDK↔Desktop 可检索。

跨层引用：K-AUDIT-001、S-ERROR-005、D-IPC-011、D-ERR-007。

## D-LLM-065 — World Generate Runtime-Only Boundary

Desktop 消费 `world.generate` 时必须保持 runtime-only 路径：

- route resolve、submit、poll、fetch-world 均必须通过 runtime surface 完成。
- `connector_id` 继续是唯一合法的远端凭据路由句柄。
- Desktop 不得直接调用 World Labs upload / generate / operations / get-world
  HTTP endpoints。
- provider viewer URL 若被展示，只能作为外部 handoff；它不构成 Desktop 拥有
  provider execution truth。

## Fact Sources

- `.nimi/spec/desktop/shell-ui.authority.yaml` — Desktop error-boundary semantics
- `config/desktop-shell-ui-error-codes.yaml` — non-authoritative Desktop bridge alias allowlist
- `tables/rule-evidence.yaml` — LLM 分层门禁与证据映射

## Preserved source: Streaming Consumption Contract

# Streaming Consumption Contract

> Authority: Desktop Kernel

## Scope

Desktop 流式消费契约。定义 renderer 进程如何消费 Runtime 流式输出（文本流、语音流），包括订阅生命周期、渲染缓冲、错误恢复、取消语义。

**跨层引用**：Runtime `K-STREAM-001~007`、SDK `S-TRANSPORT-003`。

本契约只拥有 stream lifecycle、render buffering、cancel / retry / timeout
projection 语义。Agent Chat orchestration、single-message / action semantics、
prompt payload、voice workflow、media execution、and Runtime Agent execution truth
不由 stream layer 拥有，相关真相固定来自 Runtime Agent / SDK projections。
runtime-owned deferred continuation / `HookIntent` pending truth 固定来自
`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`。

## D-STRM-001 — 流式订阅生命周期

流式消费遵循固定生命周期：

```
subscribe → onDelta(chunk)* → onDone | onError → cleanup
```

- **subscribe**：通过 SDK Runtime client 发起流式请求（`StreamScenario`）。
- **onDelta**：每收到一个非终帧 chunk，追加到渲染缓冲区。对应 Runtime K-STREAM-003 `done=false` 事件。
- **onDone**：收到终帧（`done=true`），提取 `usage` 统计，更新 UI 为完成态。对应 Runtime K-STREAM-003 终帧。
- **onError**：流建立失败或传输中断，进入 D-STRM-003 错误处理。
- **cleanup**：释放订阅资源，清除进度指示器。无论正常完成或异常终止均须执行。

若 Agent Chat projection includes single message + actions delivery，stream consumer
只能按 Runtime-owned resolved projection 消费与投影 lifecycle。stream layer 不得自行拆分、合并、重排、补造第二条文本消息，也不得把
hook-driven deferred continuation 降格成同 turn text continuation。

若 execution 涉及 runtime-owned deferred continuation / `HookIntent` 或 modality action
delivery，stream consumer 也只能消费 admitted resolved outputs。stream layer 不得决定
continuation 是否存在、不得补造 image/voice action、不得改写 relation、也不得生成
substitute `promptPayload`。

若 runtime-owned `HookIntent` outputs admit 递归 deferred continuation chain，stream
consumer 也不得把 chain ownership 退回 renderer-local chat transcript state。anchor-bound
pending continuation delay、用户消息打断、以及 chain 上限只能消费已 admit 的 runtime hook
semantics；stream layer 不得自创第二份 timer truth。

## D-STRM-002 — 渲染端缓冲策略

流式文本渲染策略：

- **增量追加**：每个 `text_delta` chunk 追加到消息气泡，不重新渲染整条消息。
- **进度指示**：流活跃期间显示打字指示器（typing indicator），终帧后移除。
- **最小 chunk 对齐**：Runtime K-STREAM-006 保证 chunk 最小 32 bytes，渲染端无需额外缓冲拼接。
- **首包超时感知**：若 subscribe 后 10s 内未收到首个 chunk（对应 K-STREAM-007 首包超时），UI 应展示超时提示而非无限等待。
- **Usage 展示**：终帧携带的 `usage` 数据（token 统计）可选展示在消息元信息区域。若上游 `usage` 字段值为 `-1`（K-STREAM-003），UI 不展示 token 统计。

## D-STRM-003 — 中途错误处理

流式传输中途错误恢复策略：

- **建流前错误**：SDK 抛出异常，走 D-ERR-005 归一化路径，UI 展示错误消息。
- **建流后中断**：流已建立但传输中断（网络断开、daemon 停止等），行为：
  1. 保留已渲染的部分文本（不清空已展示内容）。
  2. 在消息末尾追加中断标记（如"[流式响应中断]"）。
  3. 提供重试按钮，用户可选择重新发送。
- **终帧错误**：收到 `done=true` + 非零 `reason_code`，提取 reason code 走 D-ERR-007 映射为用户消息。
- **SDK 重连约束**：SDK `S-TRANSPORT-003` 禁止隐式重连续流，Desktop 不得自动重试中断的流。
- **语音流错误码**：`StreamScenario` 中途错误使用通用 provider reason codes（`AI_PROVIDER_UNAVAILABLE`、`AI_PROVIDER_TIMEOUT`、`AI_STREAM_BROKEN` 等），Phase 1 无语音专用错误码。语音流错误走 D-ERR-007 通用投影路径。

## D-STRM-004 — 取消/中止语义

用户主动取消和系统超时取消：

- **用户取消**：用户点击"停止生成"按钮，调用 SDK abort 机制取消流。已渲染内容保留，消息标记为"已停止"。
- **超时取消**：流总耗时超过 120s（K-STREAM-007 总超时，完整超时表见 D-STRM-006 / K-DAEMON-008）由 Runtime 侧终止，Desktop 收到终帧后正常处理。
- **取消后状态**：取消不触发错误边界（D-ERR-006），UI 回到就绪态，用户可立即发起新请求。
- **并发保护**：同一聊天同一时刻仅允许一个活跃流。新请求发起前必须确保前一个流已完成或已取消。

## D-STRM-005 — ScenarioJob 事件流消费生命周期

ScenarioJob 事件流（`SubscribeScenarioJobEvents`）使用独立于文本/语音流的消费生命周期。引用 Runtime K-JOB-002 终态集合和 K-STREAM-005 流关闭语义。

**生命周期**：

```
subscribe → onJobEvent* → onTerminalState(gRPC OK close) → cleanup
```

- **subscribe**：通过 SDK Runtime client 发起 `SubscribeScenarioJobEvents(job_id)` 订阅。
- **onJobEvent**：每收到一个 job 状态事件（`SUBMITTED` / `QUEUED` → `RUNNING` → ...），更新 UI 进度（进度条、状态文本）。`RUNNING` 可重复出现；Desktop 必须以事件里的最新 job snapshot 覆盖旧 snapshot，并优先消费 `progress_percent`，必要时结合 `progress_current_step` / `progress_total_steps` 展示更细粒度文案。
- **onTerminalState**：收到终态事件（K-JOB-002: `COMPLETED` / `FAILED` / `CANCELED` / `TIMEOUT`）后，server 正常关闭流（gRPC OK）。**注意**：此流不使用 `done=true` 终帧语义（K-STREAM-005），与 D-STRM-001 的 `onDone(done=true)` 生命周期根本不同。
- **cleanup**：释放订阅资源，移除进度指示器。

**终态 UI 映射**：

| 终态 | UI 行为 |
|---|---|
| `COMPLETED` | 展示生成结果（图片/视频/音频），隐藏进度条 |
| `FAILED` | 展示错误消息（reason code 走 D-ERR-007），提供重试按钮 |
| `CANCELED` | 展示"已取消"状态，保留操作历史 |
| `TIMEOUT` | 展示"任务超时"提示，建议用户重新提交 |

**与文本流的差异**：

- 文本流（D-STRM-001）：增量 chunk 追加渲染，`done=true` 终帧。
- ScenarioJob 流（D-STRM-005）：离散状态事件，gRPC OK 关闭。允许重复 `RUNNING` 事件以携带最新 job progress snapshot；结果仍在终态后通过 `GetScenarioArtifacts` 获取。

ScenarioJob 事件流只消费已经被 admit 的 modality action execution lifecycle。
无论是 admitted image、admitted voice workflow，还是未来单独 admitted 的 video workflow，
job stream 都不得反向成为 action existence、pending invalidation、或 modality prompt
semantics 的 owner。

**跨层引用**：Runtime K-JOB-001~006、K-STREAM-005。

## D-STRM-006 — AI 操作超时感知表

Desktop 必须为每种 AI 操作设置正确的 UI 超时行为。超时值引用 Runtime K-DAEMON-008 AI 超时层次。

| AI 操作 | Runtime 默认超时 | UI 超时行为 |
|---|---|---|
| `ExecuteScenario`（TEXT_GENERATE） | 30s | loading indicator 最长 30s，超时展示"AI 响应超时" |
| `StreamScenario`（首包） | 10s | 首包 10s 内无响应，展示"等待响应中…"警告 |
| `StreamScenario`（总） | 120s | 总超时 120s，由 Runtime 终止流，正常处理终帧 |
| `ExecuteScenario`（TEXT_EMBED） | 20s | loading indicator 最长 20s，超时展示"嵌入操作超时" |
| `StreamScenario`（SPEECH_SYNTHESIZE） | 45s | 语音播放器 loading 最长 45s |
| `SubmitScenarioJob`(image) | 120s | 图片生成进度条最长 120s，期间展示预估剩余时间 |
| `SubmitScenarioJob`(video) | 300s | 视频生成进度条最长 300s，期间展示预估剩余时间 |
| `SubmitScenarioJob`(stt) | 90s | 语音转文字 loading 最长 90s |

**超时处理规则**：

- Runtime 侧超时（K-DAEMON-008）返回 `DEADLINE_EXCEEDED` + `AI_PROVIDER_TIMEOUT`，走 D-ERR-007 映射。
- Desktop UI 超时指示器基于上表设置，与 Runtime 超时值保持一致。
- 用户可在超时前主动取消（走 D-STRM-004 取消语义）。

**跨层引用**：Runtime K-DAEMON-008。

## D-STRM-007 — Mode C (eof=true) 消费规则

Mode C 流（`ExportAuditEvents`，`K-STREAM-009`）使用 `eof=true` 标记最后一个数据块，server 随后 gRPC OK close。

Phase 1 不消费 Mode C 流（`ExportAuditEvents` 属于 Phase 2 `audit_service_projection`）。Phase 2 激活时补充消费规则。

**跨层引用**：Runtime `K-STREAM-008`（模式 C）、`K-STREAM-009`（eof 协议）。

## D-STRM-008 — Mode D（长生命周期订阅流）消费规则

Mode D 流（`K-STREAM-010`）没有业务层终止信号，流生命周期与 daemon/资源绑定。适用 RPC：`SubscribeRuntimeHealthEvents`、`SubscribeAIProviderHealthEvents`、`SubscribeAppMessages`。

**Desktop 消费路径**：Desktop Phase 1 **不通过 SDK Mode D 流路径**消费健康事件。等价数据通过以下 IPC 桥路径获取：

- **Runtime 健康状态**：`D-IPC-002`（`runtime_bridge_status` 轮询）提供 runtime 连接状态。
- **本地 LLM 健康**：`D-LLM-004`（`checkLocalLlmHealth`）提供即时健康检查。
- **Provider 健康**：通过 `ConnectorService.TestConnector` unary RPC 按需探测，非持续订阅。

**等价关系声明**：SDK `S-TRANSPORT-007` 将 `SubscribeRuntimeHealthEvents` / `SubscribeAIProviderHealthEvents` 归入 `health_monitoring_projection`，声明 Desktop 通过 IPC 桥消费等价数据。本规则正式确认该等价关系：Desktop 使用 IPC 桥（轮询 + 按需探测）替代 Mode D 持续订阅流，两条路径提供语义等价的健康状态信息。

**`SubscribeAppMessages` 排除**：属于 Phase 2 服务（`app_service_projection`），Desktop Phase 1 不消费。

**Mode D 流关闭处理**（仅适用于未来直接消费 Mode D 流的场景）：

- Server 以 gRPC `CANCELLED` 关闭流（daemon STOPPING 或资源不可用）。
- 收到 `CANCELLED` 后不触发错误边界（`D-ERR-006`），视为正常断开。
- 重建策略由 Desktop 消费层决定（可选自动重订阅或等待 `runtime.connected` 事件后重订阅）。
- 遵循 SDK `S-ERROR-012`（Mode D CANCELLED 语义）和 `S-TRANSPORT-003`（禁止隐式重连）。

**跨层引用**：Runtime `K-STREAM-008`（模式 D）、`K-STREAM-010`（长生命周期订阅协议）、SDK `S-TRANSPORT-007`（Mode D 投影）、SDK `S-ERROR-012`（CANCELLED 语义）。

## D-STRM-009 — 背压关闭处理（K-STREAM-011~013 投影）

Runtime 在 server-side queue depth 超预算时以 `RESOURCE_EXHAUSTED` 或 `CANCELLED` 终止流（K-STREAM-012）。Desktop 必须:

- **不得误报为完成**: 收到 `RESOURCE_EXHAUSTED` 或非用户取消的 `CANCELLED` 时，消息标记为"已中断"而非"已完成"。
- **保留已渲染内容**: 同 D-STRM-003 — 已展示文本不清空。
- **展示重试入口**: 用户可选重新发送（非幂等执行流不自动重放，K-STREAM-013）。
- **保留 traceId**: 错误对象必须携带 `traceId` 供跨层排障。
- **订阅型流可重建**: Mode D 长生命周期订阅流因背压关闭后可自动重订阅（K-STREAM-013）。

**跨层引用**: Runtime K-STREAM-011~013、SDK S-ERROR-004。

## D-STRM-010 — ScenarioJob 查询控制契约

D-STRM-005 覆盖 `SubscribeScenarioJobEvents` 订阅消费。本规则补充 ScenarioJob 的查询与控制操作，确保 AI Agent 实现完整的 job 管理路径。

**断连恢复**：

流订阅中断（网络断开、daemon 重启）后，通过 `GetScenarioJob(job_id)` 轮询恢复 job 状态：

- 轮询间隔：2s，最多重试 30 次（总等待 60s）。
- 轮询到终态（`COMPLETED` / `FAILED` / `CANCELED` / `TIMEOUT`）后停止，按 D-STRM-005 终态 UI 映射处理。
- 轮询超时（60s 仍未终态）：展示"任务状态未知，请稍后刷新"。
- 断连恢复期间 UI 展示"重新连接中…"状态。

**取消操作**：

用户在 ScenarioJob 运行中点击"取消"，触发 `CancelScenarioJob(job_id)`：

- 取消是异步 ACK 语义：`CancelScenarioJob` 成功返回仅表示取消请求已接受，job 可能在后续状态事件中才进入 `CANCELED` 终态。
- UI 在 `CancelScenarioJob` 返回后展示"取消中…"状态，等待终态事件确认。
- `AI_MEDIA_JOB_NOT_CANCELLABLE`：job 已到达终态，展示 D-ERR-007 映射消息。

**结果获取**：

终态 `COMPLETED` 后调用 `GetScenarioArtifacts(job_id)` 获取生成结果：

- 返回 artifact 列表（图片/视频/音频 URL）。
- 结果展示在 D-STRM-005 终态 UI 中。

**Connector 删除安全**（K-JOB-005）：

connector 在 job 运行中被删除不影响 job 可观测性。`GetScenarioJob` 和 `SubscribeScenarioJobEvents` 仍可正常返回 job 状态。Desktop 不需对此做特殊处理，但 UI 中已删除 connector 对应的 job 历史仍应正常展示。

**快照凭据失效**（K-JOB-006）：

job 执行中凭据失效时，Runtime 返回 `AI_PROVIDER_AUTH_FAILED` reason code，job 进入 `FAILED` 终态。走 D-ERR-007 映射："AI 服务凭证已失效，请重新配置"。

**跨层引用**：Runtime K-JOB-001~006、SDK S-ERROR-001。

## D-STRM-011 — Agent Presentation Timeline Consumption

Desktop may consume PresentationTimeline metadata only after runtime admits the
concrete `K-AGCORE-051` projection schema and SDK exposes it as typed
runtime-agent data.

Fixed rules:

- Desktop stream rendering may align text display to runtime-owned timebase and
  offset metadata, but it must not become the owner of canonical timeline truth
- Desktop must preserve `agent_id`, `conversation_anchor_id`, `turn_id`, and
  `stream_id` linkage when passing timeline-bearing handoff or diagnostic data
  to Avatar
- user stop/cancel must consume runtime stream interrupt truth and must not
  leave voice, lipsync, or avatar motion continuation running as independent
  renderer-local success
- Desktop must not use broad Event API, wildcard subscription, or app-local
  desktop event namespaces to bypass SDK/runtime-agent timeline projection
- Desktop renderer-only evidence cannot close Avatar speak/lipsync behavior

This rule admits Desktop as a timeline consumer only; runtime remains the
timeline authority and Avatar remains the lipsync/render proof owner.

## Fact Sources

- `.nimi/spec/desktop/agent-projection.authority.yaml` — D-LLM-022 ~ D-LLM-026 Desktop Agent Chat projection boundary
- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md` — Runtime Agent execution / projection authority
- `.nimi/spec/runtime/kernel/voice-contract.md` — runtime voice workflow boundary
- Runtime `K-STREAM-001~007` — 流式传输规则
- Runtime `K-STREAM-008` — 流关闭模式统一分类（Mode A/B/C/D）
- Runtime `K-STREAM-009` — eof 标记流关闭协议（Mode C）
- Runtime `K-STREAM-010` — 长生命周期订阅流协议（Mode D）
- Runtime `K-STREAM-011~013` — 背压规则（queue depth、误报约束、重试/重订阅语义）
- Runtime `K-JOB-001~006` — ScenarioJob 生命周期
- Runtime `K-STREAM-005` — ScenarioJob 事件流关闭语义
- Runtime `K-DAEMON-008` — AI 操作超时层次
- SDK `S-TRANSPORT-003` — 流式行为边界
- SDK `S-TRANSPORT-007` — 流式终帧投影（含 Mode D 投影规则）
- SDK `S-ERROR-004` — 重试语义
- SDK `S-ERROR-012` — Mode D 流 CANCELLED 语义
