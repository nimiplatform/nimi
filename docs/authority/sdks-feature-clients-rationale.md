# SDKs Feature Clients - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/sdks/feature-clients.authority.yaml`。

---

<!-- source: .nimi/spec/sdks/kernel/ai-adapter-contract.md -->

# SDK AI Adapter Contract

> Owner Domain: `S-AIP-*`

## S-AIP-001 Adapter Role

AI adapters are independent adapter packages or core AI helper boundaries, not
the removed `@nimiplatform/sdk/ai-provider` base SDK subpath. They do not own
Runtime/provider routing decisions.

- adapter factories must bind to explicit `NimiClient` / Runtime-facing
  surfaces; app identity and Runtime construction constraints remain governed
  by `S-RUNTIME-010`.
- routing/default model 选择权属于 runtime 或调用方；adapter 不得引入独立 provider 路由表。
- adapter 不得在 caller 未提供 route policy 时自行默认到
  `local` 或 `cloud`；必须要求显式 caller route policy，或消费 Runtime
  公开 projection 提供的 explicit route policy，并在缺失时 fail closed。

多模态请求验证（video mode/role 矩阵 K-MMPROV-024/025、TTS voice_ref 强类型 K-MMPROV-018、local image workflow K-MMPROV-016、artifact metadata 校验 K-MMPROV-007）均为 runtime 侧职责。SDK adapter 层仅投影公开 SDK/Runtime 方法面和错误结果，不复刻上游请求验证逻辑。

## S-AIP-002 Media Job Projection

ScenarioJob 相关方法必须保持提交/查询/取消/订阅语义一致性。

## S-AIP-003 Stream Finish Projection

流式 done/finish reason 必须完整投影给调用方，不得静默吞掉业务终态。

## S-AIP-004 Provider Catalog Alignment

provider 名称与能力对齐以 runtime `provider-catalog.yaml` 为事实源。

## S-AIP-005 Error Projection Coupling

Adapter 错误投影必须复用 `S-ERROR-*`，不得私自扩展冲突语义。

## S-AIP-006 World Generate Projection Boundary

若 runtime admitted `world.generate`，adapter 只能把它投影为
runtime-owned async capability family.

- adapter 不得把 `world.generate` 降格为 image/video alias。
- adapter 不得引入 app-side provider upload / poll / fetch protocol。
- provider-specific request shaping、connector secret ownership、以及 job
  lifecycle 继续由 runtime authority surfaces 负责。

## S-AIP-007 External AI Framework Adapter Boundary

Independent adapter packages may host adapters for external AI framework
provider contracts, including Vercel AI SDK and similar model-provider
interfaces. The base SDK must not restore `@nimiplatform/sdk/ai-provider`.

Such adapters are protocol adapters only. They may map framework calls such as
text generation, streaming, structured output, and caller-owned tool-loop
coordination onto admitted Nimi Runtime / SDK surfaces. They must preserve
`S-SURFACE-015` through `S-SURFACE-018` and `S-BOUNDARY-005` through
`S-BOUNDARY-006`.

They must not:

- introduce an independent provider/model routing table
- keep connector secrets or provider credentials outside Runtime custody
- emulate unsupported tool-calling, JSON mode, cache, reasoning, usage, or
  stream semantics as successful parity
- expose a stable OpenAI-compatible Runtime endpoint
- persist framework session, memory, or event state as Nimi canonical truth

Capability gaps must be typed and visible to the caller. Framework-specific
ergonomics are allowed only while Runtime / Realm / Cognition authority remains
the sole source for durable product state and enforcement.

## S-AIP-008 Adapter Capability Manifest Semantics

Adapter capability manifests describe target-library capabilities that are
usable through a Nimi adapter. The `support` field answers whether a caller
using the target library can exercise the named library capability through the
adapter: `supported`, `partial`, `unsupported`, or `not-applicable`.

Ownership and execution placement are recorded separately in `mode`. A
framework-owned capability, such as a target library's caller-side tool execute
callback or multi-step orchestration, must not be marked unsupported solely
because Nimi Runtime does not own that orchestration. Conversely, Runtime-owned
or adapter-owned gaps must remain explicit instead of being hidden behind a
broader target-library capability claim.

Provider-defined tools, provider-executed tool calls/results, provider approval
rounds, sources, and raw stream chunks are evaluated as target-library
interfaces. They may be marked supported by an adapter when the adapter
faithfully maps the interface to admitted Nimi SDK/Runtime contracts, while
individual Runtime provider routes still fail closed if they cannot preserve the
provider-specific semantics.

## S-AIP-009 Framework State Lifetime And Reconstructibility Boundary

This rule specializes `S-BOUNDARY-006` for external framework adapters and
adds the reconstructibility dimension. Framework-held state is classified by
two tests:

- lifetime: does the state survive beyond the current process or app session?
- reconstructibility: can the state be fully rebuilt from Nimi canonical
  truth plus caller-supplied input, or is its loss a real loss?

Classification outcomes are closed:

- in-process, reconstructible state is orchestration ephemera; the framework
  may hold it freely and the adapter needs no manifest claim for it.
- state that survives across process or app-session boundaries, or that
  cannot be rebuilt from Nimi truth, is durable framework state. It must
  either be promoted to the owning Runtime / Realm / Cognition service
  through an admitted typed operation (`S-BOUNDARY-006`), or be declared in
  the adapter capability manifest as `partial` with an explicit
  framework-owned, non-canonical gap note. Undeclared durable framework
  state is a contract violation, not a default.
- adapters must not read or write durable framework state into Nimi
  surfaces, and must not present it as Nimi session, memory, event, or
  agent-state truth (`S-AIP-007`).

L4 (`Context`) capability admission is gated on this rule: any claim that
binds framework memory or context to Nimi Cognition owner surfaces must
first classify every durable framework state cluster under these tests, and
the admission fails closed while any durable cluster remains unclassified.

---

<!-- source: .nimi/spec/sdks/kernel/ai-config-surface-contract.md -->

# SDK AI Config Surface Contract

> Owner Domain: `S-AICONF-*`

## S-AICONF-000 Runtime Target Identity v2 Hard Cut

SDK AIConfig durable refs use the v2 target grammar from `K-RTARGET-*`.
`targetId/profileId`, `localModelId`, `goRuntime*`, and cloud refs without
`remoteModelCatalogId` are retired as durable target identity.

## Scope

定义 SDK 对 `AIProfile / AIConfig / AISnapshot` 的 typed surface，使 app consumer 无需直接操作底层 capability fragments 作为主真相。本契约依赖 desktop canonical model（D-AIPC-001~014）和 platform scope identity（P-AISC-001~005）。

## S-AICONF-001 — Typed Surface Categories

SDK AI config surface 固定分为以下 logical operation 类别：

### Profile catalog

- `aiProfile.list()` — 列出当前可用 profile catalog
- `aiProfile.get(profileId)` — 获取单个 profile 详情
- `aiProfile.validate(profile)` — static schema probe（D-AIPC-012 第一层）

### Profile apply

- `aiProfile.previewApply(scopeRef, profileId, requirementRef?)` — 计算（不提交）
  将 profile 应用到 scope/requirement 时产生的 typed before→after `AIConfig`
  diff or setup-required/no-live-config outcome（D-AIPC-014）。详见 S-AICONF-008。
- `aiProfile.apply(scopeRef, profileId)` — 将 profile 原子覆盖到 scope 的 AIConfig（D-AIPC-005）
- apply 必须返回 typed result，包含 success / failure reason / probe warnings
  or setup-required/no-live-config outcome。Unresolved required slices must not
  produce a live AIConfig write.

### Config read / write

- `aiConfig.get(scopeRef)` — 读取 scope 的当前 AIConfig
- `aiConfig.update(scopeRef, patch)` — 更新 scope 的 AIConfig（full materialized write，不允许 partial overlay）
- `aiConfig.listScopes()` — 列出已知 scope 集合
- 上述 config read / write 适用于 app / module / feature scope；consumer 不得以 ad hoc settings object、route override store、domain payload field 取代该 formal surface。

### Adjacent live config

- SDK host surface 可暴露与 `AIConfig` 相邻但不属于 `AIConfig.capabilities` 的
  typed adjacent live config family
- memory embedding 是第一类 admitted adjacent live config
- 对 memory embedding，host-facing logical family 至少允许：
  - `memoryEmbeddingConfig.get(input)` — 读取 Runtime-owned 当前 binding
    intent；`input` 必须包含 explicit runtime target identity
  - `memoryEmbeddingConfig.update(input, config)` — 向 Runtime 提交 explicit
    user intent；SDK 只构造 typed request，不持久化 intent
  - `memoryEmbeddingConfig.subscribe(input, callback)` — 订阅 SDK consumer
    lifecycle 内的非权威刷新通知；不得伪装为 Runtime event stream
- 该 family 不拥有 host-local editable config truth；不得返回或持久化 resolved
  embedding profile、bank bind result、migration state、或 cutover outcome。
  Runtime Local Agent `text.embed` intent belongs to Runtime Agent AI Config per
  `K-AGCORE-144` / `K-MEM-004a`; resolved memory operation state remains Runtime
  memory / RuntimeCognitionService projection per `K-MEM-006b`.

### Runtime-owned memory state / operation projection

- SDK host surface 可以为 memory embedding 暴露与 runtime 交互的 typed logical
  projection/command family，但这不是 daemon public RPC parity 要求
- 对 memory embedding，host-facing logical family 至少允许：
  - `memoryEmbeddingRuntime.inspect(input)` — 读取 runtime-resolved state、
    availability、以及 bind / cutover readiness
  - `memoryEmbeddingRuntime.requestBind(input)` — 请求 runtime 执行 canonical
    bind
  - `memoryEmbeddingRuntime.requestCutover(input)` — 当 admitted runtime
    policy 要求 rebuild / generation cutover 时，请求执行 explicit cutover
- 当 runtime canonical bank lifecycle target 不被 `AIScopeRef` 自身唯一标识时，
  `input` 必须包含显式 runtime target identity；host 不得通过 active chat
  selection、renderer-local current agent、或默认 app scope 隐式猜测 bank
  owner
- 这些 logical methods 只表达 host product surface；它们可以由 host bridge 映射到
  runtime-private typed path，但不得被解释成新增 daemon public method family
- 其 runtime-side logical owner 对齐 `K-MEM-006b` 的 runtime-private memory
  embedding operation family；host facade 不得私自扩展第二套 product semantics
- SDK 不得要求 host 提供同步 durable config reader，不得把 Desktop localStorage /
  Tester fixture / renderer store 当作 canonical binding intent input；ephemeral test
  harness 可以 mock Runtime methods，但必须保留 request/response shape。

### Probe

- `aiConfig.probe(scopeRef)` — 对当前 AIConfig 执行 runtime availability probe（D-AIPC-012 第二层），消费 `runtime.route.checkHealth` / `runtime.route.describe`。返回 `AIConfigProbeResult`。
- `aiConfig.probeFeasibility(scopeRef)` — 对当前 AIConfig 执行 **scope aggregate** resource feasibility probe（D-AIPC-012 第三层）。消费 runtime `Peek`（K-SCHED-002）返回的 aggregate `SchedulingJudgement`，并在 `AIConfigProbeResult.schedulingJudgement` 中传递该 typed aggregate scheduling state。返回 `AIConfigProbeResult`。
- `aiConfig.probeSchedulingTarget(scopeRef, target)` — 对当前 submit-specific execution target 执行 target-scoped scheduling evaluation。`target` 语义对齐 K-SCHED-002 `SchedulingEvaluationTarget`。该调用消费 runtime `Peek`（K-SCHED-002）的 atomic target judgement，供 submit guard / execution snapshot evidence 使用。它不返回 scope aggregate judgement。

### Snapshot record / read

- `aiSnapshot.record(scopeRef, snapshot)` — 通过 Desktop host authority 记录当前 execution 的 canonical snapshot
- `aiSnapshot.get(executionId)` — 读取特定执行的 snapshot
- `aiSnapshot.getLatest(scopeRef)` — 读取 scope 最近一次执行 snapshot
- snapshot record / read 适用于 canonical app, module, and feature scopes；consumer 不得定义 consumer-local `AISnapshot` schema 或 local persistence 作为平行 owner。
- SDK may expose typed scoped `AISnapshot` host-store helpers, but those helpers
  are storage mechanics only. Production host `record` / `get` / `getLatest`
  must use host persistence and must fail closed when host storage is
  unavailable. Process-memory stores are admitted only as explicitly named
  test/development harnesses.

## S-AICONF-002 — No Fallback Surface

SDK AI config surface 不暴露 fallback knob：

- 不允许 `apply({ fallback: 'allow' })` 式参数。
- apply 失败时必须返回 typed error，不允许静默降级到 partial config。
- probe 结果必须是 typed enum（`available` / `unavailable` / `degraded` / `unknown`），不允许 generic string reason。
- `probeFeasibility` 返回的 `AIConfigProbeResult.schedulingJudgement`（如果存在）必须是 typed `AISchedulingJudgement`，其 `state` 为 K-SCHED-001 封闭枚举。该值固定表示 scope aggregate judgement。`denied` 是 hard failure，不是 degraded success。`unknown` 只允许在 runtime 缺少评估信息时返回，且不得投影成 `runnable`。
- `probeSchedulingTarget(scopeRef, target)` 返回的 scheduling evidence 必须保持 typed `AISchedulingJudgement`，并严格对应该 target；不允许返回 scope aggregate judgement 作为近似值。
- `aiSnapshot.record(scopeRef, snapshot)` 必须显式传入 `scopeRef`，且 host 记录的 snapshot.scopeRef 必须与该 canonical scope 一致；不允许在 caller 省略 scope 时隐式回退到 chat scope。
- raw `runtime.route.*`、`runtime.scheduler.peek`、runtime local profile install/probe surface 只是不透明 low-level dependency；consumer 不得直接把这些 low-level API 作为 product-facing `AIConfig` / `AISnapshot` surface。
- SDK low-level host store helpers may expose an explicitly named ephemeral
  store for test/development harnesses only. If host storage is unavailable and
  that explicit harness mode is not enabled, all AIConfig persistence operations
  (`has` / `load` / `save` / `listScopeKeys`) must fail closed. The surface must
  not use fallback terminology or silently degrade production persistence into
  process memory.

## S-AICONF-003 — AIScopeRef Consumption

SDK surface 的 scope parameter 统一使用 `AIScopeRef`（P-AISC-001）：

- SDK 不自行定义 scope identity schema。
- SDK 传入的 `AIScopeRef` 必须由 canonical factory 产出（P-AISC-002），SDK 不允许接受任意拼接的 scope key。
- SDK 不在 `AIScopeRef` 上附加 consumer-local fields（P-AISC-005）。
- AIConfig surface 调用必须显式传入 `scopeRef`；SDK 不得在 caller 省略 scope 时隐式回退到 `{ kind: 'app', ownerId: 'desktop', surfaceId: 'chat' }` 或其他 consumer-default scope。
## S-AICONF-004 — Runtime Local Profile Bridge

SDK 暴露 `AIProfile` -> runtime-facing descriptor 的 typed bridge：

- `aiProfile.formRuntimeDescriptor(profileId, scopeRef, requirementRef?)` — 将
  portable `AIProfile` capability slices 和 app/module/feature requirement
  declaration 投影为 contract-bound runtime-facing descriptor。
- legacy `aiProfile.resolveLocalDependencies(profileId, deviceProfile?)` semantics
  are superseded as an authority boundary: SDK may keep a helper name only if it
  forms the same descriptor and does not pre-resolve runtime materialization
  facts.
- Descriptor formation may include portable profile refs, source profile digest,
  slice ids, capability ids, execution mode, authored `execution.backend` and
  `model.family` constraints, cloud connector non-secret selector, asset/source
  binding refs, ordered companion occurrence refs, params/editable fields, and
  requirement ids.
- Descriptor formation must not include RuntimeRouteBinding, selectedBindings
  runtime evidence, local paths, local asset ids as portable truth, selected
  source records, install/materialization evidence, workflow binding ids,
  backend package/Python/Torch/CUDA evidence, provider health, scheduler state,
  endpoint values, raw connector secret, token, API key, or credential payload.
- Runtime independently validates, prepares, materializes, and projects
  readiness from the descriptor; SDK/host request formation is not runtime
  support truth, selected-source truth, or materialization truth.
- SDK 不暴露 runtime descriptor 的裸构造器给 app；app 只能通过 admitted
  `AIProfile` + requirement declaration bridge 路径产出 descriptor。

## S-AICONF-005 — Transport Boundary

SDK AI config surface 在 Phase 1 是 host-local surface（数据存储与 projection 在 desktop/web host 内），不是 daemon RPC projection：

- config read/write 操作走 desktop host persistence，不走 runtime daemon RPC。
- probe 操作消费 runtime daemon 的现有 route/health RPC（S-RUNTIME-074）。
- scheduling probe 操作消费 runtime daemon `Peek`（K-SCHED-002）。
- snapshot record / read 操作走 desktop host persistence。
- 本契约不在 runtime daemon 上新增 AIConfig CRUD RPC。
- host-local persistence may store AIConfig compact logical refs and params only.
  It must reject or drop any RuntimeRouteBinding-like shape, selected source
  record, install/materialization evidence, workflow binding id, local path,
  backend environment evidence, provider health, scheduler state, or credential
  payload before persistence.
- generic adjacent live config may use host-local persistence / subscription
  surface, but Runtime Local Agent memory embedding is excluded: committed
  `text.embed` intent belongs to Runtime Agent AI Config and is mutated through
  Runtime/SDK ai-config surfaces
- memory embedding 的 runtime-resolved state 与 canonical bind / rebuild /
  cutover 请求，可由 host typed surface 暴露为 logical methods，但其 runtime 侧承载面必须是 admitted typed boundary，不得退化成 private loopback convenience HTTP 的产品化包装
## S-AICONF-006 — Subscription Surface

SDK 必须提供 AIConfig 变更订阅：

- `aiConfig.subscribe(scopeRef, callback)` — 当 scope 的 AIConfig 发生变更（apply / update）时通知 consumer。
- subscription 是 host-local event，不走 runtime daemon event stream。
- 用于驱动 `ConversationCapabilityProjection` 重算（D-LLM-017）。
## S-AICONF-007 — First-Run Evidence Ref Consumption

SDK may expose typed helpers for first-run built-in AIConfig finalization, but
it does not own the resulting ready evidence refs.

`MUST`:

- any SDK helper that applies first-run built-in configs must require explicit
  canonical `AIScopeRef` values and must preserve the exact `desktop.chat.nimi`
  and `desktop.chat.agent` identities from `P-AISC-006`
- returned `builtInAiConfigRefs` are host/backend-issued durable evidence refs
  that the product-control admission backend must verify through Desktop host
  AIConfig authority; SDK callers cannot mint or validate them by string shape
- SDK surfaces must keep `accountDefaultProfileRef`, `runtimeBaselineRef`, and
  `executionEvidenceRef` opaque and typed; verification belongs to
  `RuntimeAccountService`, `RuntimeLocalService`, Runtime execution evidence,
  and product-control admission
- SDK Runtime surface may consume a verified Runtime `executionEvidenceRef`
  capability proof only as readiness/admission evidence for first-run built-in
  finalization. It must not project Runtime proof fields into AIConfig selected
  bindings or any RuntimeRouteBinding-like live config shape. The committed
  AIConfig must be produced by S-AICONF-004 descriptor/apply projection and must
  contain only compact logical refs and params admitted by D-AIPC-003.

`MUST NOT`:

- SDK must not accept renderer/localStorage values, app-local caches,
  route-health probes, file paths, or caller-provided strings as sufficient
  first-run readiness evidence
- SDK must not expose a fallback chat scope or infer `desktop.chat.nimi` /
  `desktop.chat.agent` from an omitted scope
- SDK must not derive first-run built-in AIConfig provider, engine, model, or
  consumer bindings from `runtimeBaselineRef` activation consumers. Binding
  projection must consume Runtime execution evidence proof.
- SDK must not copy `executionEvidenceRef`, `runtimeBaselineRef`,
  `runtimeConsumerId`, route endpoints, local model ids, goRuntime* fields, or
  selected-source evidence into AIProfile or AIConfig.

## S-AICONF-008 — Profile Apply Preview Surface

SDK 必须暴露 typed profile apply preview surface，使 app consumer 能在
commit 之前向用户展示 apply 的影响（D-AIPC-014）：

- `aiProfile.previewApply(scopeRef, profileId)` — 对给定 canonical `AIScopeRef`
  与 catalog profile 计算 typed before→after `AIConfig` diff，并返回该 diff 加上
  任何 probe / feasibility warning。
- 返回值是 typed preview result，至少包含：
  - `before: AIConfig | null` — preview 计算时该 scope 的当前 `AIConfig`；首次
    apply（scope 尚无 config）时为显式 `null`。
  - `after: AIConfig | null` — required slices ready/apply-eligible 时，按
    `D-AIPC-005` overwrite 语义 full materialize 出的目标 `AIConfig`
    （overwrite，不是 merge / partial patch）；setup-required/no-live-config 时
    必须为 `null`。
  - `outcome` — closed typed enum:
    `ready_to_apply | setup_required_no_live_config | unsupported_no_live_config |
    invalid_profile | invalid_requirement | stale_base | failed`。
  - `setupProjection?` — 当 outcome 为 no-live-config 时返回 typed unmet
    requirement / blocking capability / action ref / reason-code projection。
  - typed before→after diff 结构，覆盖 `capabilities`、`profileOrigin` 及其他
    materialized 字段。
  - `baseVersion` — `before` 所基于的 config version / content hash，使 caller
    在 commit 前可判断 preview 是否仍 fresh。
  - probe / feasibility warning（对齐 `aiConfig.probe` / `probeFeasibility` 的
    typed enum 与 `AISchedulingJudgement` 形状，见 S-AICONF-002）。
- `previewApply` 是 **non-committing** surface：它不写入 live `AIConfig`，不触发
  `aiConfig.subscribe`（S-AICONF-006）通知，不记录 `AISnapshot`。commit 仍由
  caller 显式调用 `aiProfile.apply`（S-AICONF-001 / D-AIPC-005）完成；SDK 不在
  `previewApply` 内部隐式提交，也不缓存 preview 作为后续 apply 的权威输入。
- `previewApply` 是 typed surface，不暴露任何 fallback knob（与 S-AICONF-002 一致）：
  - 不允许 `previewApply({ fallback: 'allow' })` 式参数。
  - profile / config schema invalid 时必须返回 typed error 并 fail closed，
    不允许返回 partial diff 或被截断的 `after`。
  - probe / feasibility warning 必须是 typed enum，不允许 generic string reason。
- unresolved required slice, connector credential missing, manual association
  missing, or unsupported backend/model family must be returned as
  no-live-config outcome, not advisory warning.
- `previewApply` 必须显式传入 canonical `AIScopeRef`（S-AICONF-003）；不允许在
  caller 省略 scope 时隐式回退到 chat scope 或其他 consumer-default scope。
- preview 与 commit 之间发生的 live `AIConfig` 变更会使 `baseVersion` 过期；此时
  `aiProfile.apply` 必须依据 D-AIPC-005 的 scope-level CAS 保护处理，SDK 不得用
  过期 preview 的 `after` 绕过 commit 端的 version 校验。

## S-AICONF-009 — Per-App First-Launch AIConfig Initialization

When a Nimi App is launched as a Nimi App, its app-scope `AIConfig` is
initialized on first launch only. SDK may expose a typed helper for this
finalization (e.g. an `appLifecycle.ensureAppAIConfig` surface), but the
initialization semantics are fixed by this rule.

`MUST`:

- the initialization target scope must be a canonical `AIScopeRef` of the
  app shape `{ kind: 'app', ownerId: <admitted app_id>, surfaceId? }`
  (`P-AISC-007`, `S-AICONF-003`); the helper must require an explicit
  `AIScopeRef` and must not infer it
- on first launch, when the app scope has no existing `AIConfig`, the helper
  must initialize it from the app's recommended profile — the typed factory
  `AIProfile` reference declared by the app's registry row
  `ai_profile_selection_ref` (`P-NAPP-002` / `P-NAPP-003`, `P-AIPS-009`) —
  **only when** that reference is declared and resolves to an admitted
  factory `AIProfile` whose manifest requirements the app validates as
  satisfied
- when the recommended profile is undeclared, unresolvable, or its manifest
  requirements are not satisfied, the helper must initialize the app scope
  `AIConfig` from the Account Default Profile (`accountDefaultProfileRef`,
  `P-AIPS-013`)
- initialization must go through the typed `aiProfile.apply(scopeRef,
  profileId)` overwrite path (`S-AICONF-001`, `D-AIPC-005`); it produces a
  full materialized `AIConfig`, not a partial overlay
- when neither a satisfied recommended profile nor a resolvable Account
  Default Profile is available, the helper must fail closed with a typed
  error and must not launch with a synthesized, empty, or placeholder
  `AIConfig`
- when the app scope already has an existing `AIConfig`, the helper must
  treat first-launch initialization as already complete and return the
  existing config unchanged
- when the app validates the materialized `AIConfig` against its manifest
  requirements and finds them unmet, the helper must return a typed
  setup/repair plan describing the unmet requirements; it must not silently
  mutate the profile, the app scope `AIConfig`, or factory profile templates
  to force a pass
- when required app/module/feature requirements cannot be satisfied, the helper
  must return a typed setup-required/no-live-config projection and must preserve
  any existing valid AIConfig unchanged. On first launch with no existing config,
  app AI surfaces that depend on unmet required slices must open unavailable /
  setup-required, not with a synthesized placeholder config.

`MUST NOT`:

- the helper must not overwrite, merge into, reset, or otherwise mutate an
  existing per-app `AIConfig` on any launch after the first; a changed
  Account Default Profile or a changed registry `ai_profile_selection_ref`
  must never silently re-initialize an app scope that already has a config
- the helper must not expose a fallback knob (`ensureAppAIConfig({ fallback:
  'allow' })` style), must not downgrade a fail-closed result to a partial
  config, and must not project an initialization failure as launch success
- the helper must not accept renderer/localStorage values, app-local caches,
  caller-provided strings, route-health probes, or file paths as a substitute
  for the resolved recommended profile or Account Default Profile evidence
- initialization must not be performed by the runtime install path; install
  handles package readiness only and must not mutate AIConfig (Apps manual
  authority; `K-APP-011`)

## S-AICONF-010 — App/Module/Feature Capability Requirement Declaration

SDK owns the typed declaration contract for app/module/feature AI capability
requirements. This declaration is distinct from Runtime local environment
activation consumers (`K-LENV-ACT-*`).

The field-level schema owner for app/module/feature requirement declarations is
`tables/ai-config-capability-requirements.yaml`. The rule body owns semantics,
authority split, and fail-closed behavior only; it must not maintain a parallel
field schema. Any field overview in prose is non-normative and subordinate to
that YAML table.

`MUST`:

- SDK must validate requirement declarations before `previewApply`, `apply`, and
  first-launch initialization.
- Requirement declarations must conform to
  `tables/ai-config-capability-requirements.yaml`; schema evolution must amend
  that table rather than duplicating fields in this rule body.
- Kit may consume this declaration for trimming UI and editable controls, but
  Kit must not own readiness, materialization, execution backend, model family,
  source selection, or setup state.
- Runtime activation `consumer_id` is only a downstream readiness/materialization
  consumer. It must not be conflated with the app/module/feature requirement
  owner or used as an `AIScopeRef`.
- Required slices with unresolved readiness produce
  setup-required/no-live-config. Optional slices with unresolved readiness are
  omitted from live AIConfig and projected as optional unavailable.

`MUST NOT`:

- SDK, Kit, Desktop, or apps must not replace this declaration with a flat
  enabled-capability list, runtimeReady boolean, app-local manifest shadow
  truth, or Runtime activation consumer table.
- Requirement declarations must not contain local paths, selected source
  records, materialization evidence, route bindings, provider health, scheduler
  state, or connector secrets.

## S-AICONF-011 — Compact AIConfig Ref Validation

SDK owns the host-facing validator for compact AIConfig logical refs admitted by
D-AIPC-003.

Allowed ref families:

- `profile_slice_ref`: source profile id/version/digest plus profile-local
  `slice_id`.
- `local_runtime_target_ref`: `kind=local-runtime`, `version=v2`, and exactly
  one of `profileBindingId` or `readinessRef`. It must be non-path,
  non-secret, non-evidence, and resolvable only by Runtime
  prepare/readiness APIs. `targetId/profileId`, `localModelId`, and
  `goRuntimeLocalModelId` are not admitted durable refs.
- `cloud_connector_target_ref`: `kind=cloud-connector` with non-secret
  `connectorId`, required `remoteModelCatalogId`, required `providerModelId`,
  and `provider` when available. `connectorId` plus provider model id without
  `remoteModelCatalogId` is not an admitted durable target ref.

Forbidden payloads:

- `RuntimeRouteBinding`, `selectedBindings` runtime evidence, endpoint URLs,
  localModelId/goRuntime* fields, providerHints, local paths, selected source
  records, install/materialization records, workflow binding ids,
  backend/Python/Torch/CUDA evidence, provider health, scheduler state, raw
  connector secret, token, API key, OAuth payload, or credential JSON.

Validators must fail closed on forbidden payloads for both AIProfile import and
AIConfig persistence. A legacy field name may be accepted only if the payload
passes the compact-ref validator; otherwise it must be rejected, not shimmed.

## Fact Sources

- `.nimi/spec/desktop/ai-consumption.authority.yaml` — D-AIPC-001~014
- `.nimi/spec/platform/core-protocol.authority.yaml` — P-AISC-001~007
- `.nimi/spec/platform/core-protocol.authority.yaml` —
  P-AIPS-009 first-party app AIProfile hint, P-AIPS-013 Account Default Profile
- `.nimi/spec/platform/app-ecosystem.authority.yaml` —
  P-NAPP-002 registry row schema, P-NAPP-003 AIProfile selection hint
- `.nimi/spec/runtime/app-surface.authority.yaml` — K-APP-017 app Open flow
- `.nimi/spec/runtime/ai-provider.authority.yaml` — K-AIEXEC-001~007
- `.nimi/spec/runtime/memory-world.authority.yaml` — K-MEM-004~006b
- `.nimi/spec/runtime/memory-world.authority.yaml` — K-SCHED-001~007
- `.nimi/spec/sdks/feature-clients.authority.yaml` — S-RUNTIME-074~078
- `.nimi/spec/sdks/client-core.authority.yaml` — S-SURFACE-001~011

---

<!-- source: .nimi/spec/sdks/kernel/nimi-app-client-contract.md -->

# SDK Nimi App Client Contract

> Owner Domain: `S-APP-*`

## Scope

定义 SDK 对 Platform `Nimi App` catalog、Runtime local-record projection 与
final local-app carrier 的 typed consumer surface。0K 不 admit immutable
package install/import/update/promotion/repair accessor，也不让 SDK 选择
principal、launch target、account、process 或 session。Desktop hosted shell
（D-HOME-004 / D-HOME-005）通过 SDK projection 投影 Apps。

## S-APP-001 — Sole Admitted Access Path

`MUST`：SDK Nimi App client surface 是 app / developer / Desktop hosted
shell 消费 verified catalog、account inventory、Runtime local-record status
与 host-injected local-app carrier 的唯一 admitted typed path。

`MUST NOT`：app / developer / shell 不得：

- 绕过 SDK 直接读写 Platform `nimi-app-registry.yaml`
- 绕过 SDK 直接调用 Runtime app registration 私有 RPC
- 私自实现 installer / package-manager / source-selector 逻辑
- 通过 app id、path、manifest、renderer metadata 或 SDK argument 选择
  principal、launch、account、grant 或 session

## S-APP-002 — Logical Operation Set

`MUST`：0K SDK 暴露以下 inventory logical operation：

- `app.list()` — 列出当前用户可见的 unified Apps inventory。该集合由
  Platform ordinary catalog source、Runtime authenticated account inventory
  source、Runtime local-record source 合成；source 必须保留，不能互相推断。
- `app.get(appId)` — 获取单个 app inventory entry 与 source/state/action
  projection。
- `app.status(appId)` — 获取 app health/repair projection state。
- `app.subscribe(callback)` — 订阅 app lifecycle 事件；host-local
  event stream。

`MUST NOT`：0K Nimi App client 不暴露 `app.install`、`app.update`、
`app.uninstall`、`app.launch`、`app.healthRepair`、import、promotion 或 package
job mutation。Immutable readiness 只能通过 `S-APP-018` 返回 typed
unavailable；local-development launch is native-host initiated and never an SDK
app-id call.

## S-APP-003 — No SDK Launch Selector

`MUST`：local-development launch 只能由 verified native `local_app_control`
supervisor 执行 `PrepareLocalAppLaunch`、process bind 与 request-empty session
open。SDK/app code只消费已注入 carrier。

`MUST NOT`：SDK 不得暴露 app-id/path/scope/package/host selector 来创建或
恢复 local-app session，也不得从 active chat、renderer state、default scope
或 manifest 推断 launch authority。

## S-APP-004 — Non-Owner Of Installer / Selector / Marketplace

`MUST NOT`：SDK Nimi App client surface 不拥有：

- installer / package-manager / PATH / source-selector 逻辑
- marketplace / economy / review / kill-switch truth
- Nimi App admission decision（属于 Platform `P-NAPP-*`）
- runtime registration / sandbox / process supervision truth（属于
  Runtime）
- GitHub/npm/source workspace discovery truth

## S-APP-005 — Typed Projection State

`MUST`：所有 logical operation 返回 typed projection state，与 Platform
`P-NAPP-008` health/repair fail-closed semantics 对齐。

`MUST NOT`：不得从 transfer completion、endpoint reachability、process
liveness、file existence 推断 `ready`；不得通过 generic `unavailable`
collapse 多种 fail-closed reason。

## S-APP-006 — Projection Family Reuse

`MUST`：SDK Nimi App client surface 复用 `S-AICONF-001..S-AICONF-006`
与 `S-RUNTIME-119` 的 typed projection paths；与 factory AIProfile
selection / runtime local environment 的 binding 通过这些 projection
一致表达。

`MUST NOT`：不引入第二套 projection family；不暴露 raw runtime / realm /
cognition transport。

## S-APP-007 — No Fallback Knob

`MUST`：错误返回 typed error，遵守 `S-AICONF-002` no-fallback 模式。

`MUST NOT`：不暴露 `{ fallback: 'allow' }` 类参数；不静默降级到 partial
install / partial launch；不把 Runtime fail-close 隐藏为 success。

## S-APP-008 — Subscription Scope

`MUST`：`app.subscribe(callback)` 仅承载 catalog/account/local-record
projection event（source degraded、record active/dormant/removed、session or
grant posture changed 等 typed event）。

`MUST NOT`：subscription 不承载 audit / permission / spend 事件；permission
fabric 与 Realm audit 拥有 audit truth。

## S-APP-009 — Catalog Source Ordinary Visibility Filter

`MUST`：SDK `app.list()` 的 catalog source and Desktop Apps consumers must only
project catalog-sourced apps whose registry row resolves as ordinary visible:

- `admission_status=admitted`
- `ordinary_visibility=ordinary-visible`
- package kind is admitted
- release descriptor resolves
- trust/runtime/permission/storage policy refs resolve

Avatar must not appear from the catalog source for ordinary Apps, even when an
internal registry row exists for bundled package/update coordination.

`MUST NOT`：SDK must not expose unadmitted workspace apps, app-local spec rows,
Avatar hidden-internal rows, or source-discovered packages as catalog Apps.
Account inventory and local-record sources are admitted separately by
`S-APP-020` / `S-APP-021`; they MUST NOT be relabeled as ordinary catalog truth.

## S-APP-010 — Immutable Package Mutation Non-Admission

`MUST`：verified release descriptors are read-only discovery/review input in 0K.
SDK may project catalog metadata but cannot download, inspect, unpack, register,
install, import, update, promote, rollback, repair or execute an immutable
artifact. Those operations are absent from the Nimi App client and Runtime
package readiness maps to typed unavailable.

`MUST NOT`：SDK must not perform direct `npm install`, `npx`, GitHub clone,
source build/run, lifecycle script execution, digest-only admission, or local
file scanning as package truth.

## S-APP-011 — Principal-Keyed Storage Boundary

`MUST`：Runtime private storage is partitioned by the inherited
`local_app_principal_id`, never app id. The local-app SDK carrier exposes no
absolute root or root accessor. Its only admitted storage surface is the exact
JSON operation set defined by S-APP-017; all other storage and file operations
remain typed unavailable.

`MUST NOT`：SDK must not construct or return `<nimi_data>/apps/<app-id>` paths,
accept a principal selector, inspect Runtime config, or infer storage from
filesystem existence. Tombstoned data is delete-only owner state and cannot be
rebound by SDK.

## S-APP-012 — Public Permission Declaration Boundary

The developer-authored manifest may carry only `permissions: [{ id, reason }]`
using admitted rows from the Platform public permission catalog. The verified
registry projects the same list as `permission_requirements`; release
descriptors may reference that reviewed list through `permissions_ref`.
Declaration is request eligibility and review transparency, not authority.

The runtime app client does not expose legacy scope/qualifier carriers and does
not derive live permission posture from a manifest or descriptor. Live status
and requests use only the host-injected `permissions.status(permissionId)` and
`permissions.request({ permissionId, reason })` surface. Current posture comes
from the row's single decision owner; an app declaration, trust tier, review
result, app id, or prior success cannot manufacture `granted`.

The SDK must reject unknown, reserved, or non-admitted permission ids before a
positive request and must never expose `AIScopeRef`, `scopeFamily`, `scopeName`,
`qualifier`, internal `operationId`/`resourceRef`, selector fingerprints, or
owner grant identifiers. Base entitlements and app-owned authority are
forbidden from manifest permission declarations and remain usable without a
permission request.

Cross-references: `P-NAPP-018`, `P-PERM-002`, `P-PERM-007`,
`P-PERM-015`, and `S-PERM-*`.

## S-APP-013 — Destructive Local-App Data Deletion Non-Admission

0K admits no immutable uninstall or SDK delete-data prompt/action. A local-app
principal tombstone leaves retained durable data as Runtime-owned delete-only
state; reinstall, reauthorization, same app id, same project, or SDK inventory
composition cannot rebind it.

`MUST NOT`: SDK must not expose `app.uninstall`, force-delete, retain/delete
choice, absolute data path, size-derived deletion decision, direct filesystem
mutation, or pseudo-success cleanup. A future deletion surface requires its own
Runtime owner operation, fresh presence, impact preview, principal-bound target,
and positive/negative evidence without reshaping the 0K principal/record seam.

Cross-references: `K-APP-014` (0K tombstone/delete-only posture),
`P-NAPP-015` (principal-keyed storage policy), `S-APP-011` (no SDK path/root
projection).

## S-APP-014 — File-Scope Client Non-Admission

SDK Nimi App client surface does not admit a callable file-API client in
the current public SDK.

The following consumer-side operations are explicitly non-admitted and MUST
NOT be exposed as active SDK APIs:

- `file.read(path, range?)`
- `file.write(path, bytes, mode)`
- `file.list(path)`
- `file.delete(path)`
- `file.move(sourcePath, destinationPath)`

`P-PERM-011` retires the former `app-local-drafts`, `file.read.scoped`, and
`file.write.scoped` permission vocabulary. `K-APP-018` explicitly does not admit a
generic Runtime-mediated file API. The three exact S-APP-017 JSON storage
operations are not a file client: they accept no bytes, directory, move, raw
delete, mode, range, root, or absolute-path input. Therefore the SDK MUST NOT map
`file.read.scoped` / `file.write.scoped` grants to hidden Runtime methods,
Desktop bridge helpers, Realm REST calls, generic HTTP proxy calls, or
direct filesystem paths. Missing file client support is a fail-closed
non-admission state, not a fallback to another transport.

SDK must not expose a legacy file-scope declaration or grant projection. Future
external-file access can be admitted only through the `files.open` / `files.save`
one-shot picker rows and their owner-issued handles.

Cross-references: `K-APP-018` (Runtime-mediated file-API non-admission),
`P-PERM-011` (retired file-scope identifiers), `P-PERM-002` (closed public
permission catalog), `P-NAPP-027` /
`P-NAPP-028` (`nimi-mediated-default` vs `app-owned-os-storage` posture).

## S-APP-015 — Review-Evidence Accessor

**Background fact.** `P-NAPP-025` admits the `review.decision` closed
enum (`approved | revision-requested | rejected | kill-switched`) plus
the accompanying review-evidence sub-fields `review.adjudicator_kind`
(`human | nimi-automated-gate`), `review.adjudicator_ref`,
`review.decided_at`. `P-AUDIT-006` admits the review-evidence shape on
the admitted release descriptor (`audit_evidence_ref`,
`ai_audit_model_ref`, `scanner_results_ref`) and cross-references
`P-NAPP-025` without redefining it. Parent invariant `PI-W3-34`
records "review status" as a first-level Apps-surface display field.
Both `P-NAPP-025` and `P-AUDIT-006` are admitted authority; this rule
admits the SDK CONSUMER accessor only.

`MUST` (typed accessor surface). SDK Nimi App client surface admits a
typed read-only accessor over the admitted release-descriptor's
review block. The accessor exposes the typed fields owned by
`P-NAPP-025`:

- `decision` — closed enum `approved | revision-requested | rejected
  | kill-switched`;
- `adjudicator_kind` — closed enum `human | nimi-automated-gate`;
- `adjudicator_ref` — string reference (reviewer policy or human
  reviewer identifier);
- `decided_at` — terminal-decision timestamp owned by the review record.

The accessor is read-only; it returns the descriptor's terminal
review-decision record as admitted. The accessor is the SDK surface
the Apps first-level display ("review status" per parent invariant
`PI-W3-34`) and Desktop hosted shell admission-trail UX consume.

`MUST` (placement). The review-evidence accessor is admitted in
S-APP. It is NOT admitted in `S-PERM-*`. The Permission Client
Contract (`nimi-permission-client-contract.md`) covers permission
grant lifecycle only; the review-decision record is an
admission-evidence accessor over the admitted release descriptor,
not a permission grant lifecycle accessor. See `S-PERM-010` below for
the explicit S-PERM anti-target rule.

`MUST` (consume-only; no policy drive). The accessor reads the
admitted review record; it MUST NOT drive policy. The accessor MUST
NOT gate `app.launch`, MUST NOT gate `app.install`, MUST NOT gate
grant requests, MUST NOT alter `app.list` ordinary-visibility
filtering, and MUST NOT alter Apps-surface visibility decisions. The
authoritative launch gate is `K-APP-017` + `P-NAPP-008`; the
authoritative admission gate is the `P-AUDIT-001` publish-to-
admission gate sequence; the authoritative grant lifecycle is
`S-PERM-*`. This accessor is the SDK consumer surface over the
already-admitted decision record only.

`MUST NOT` (no schema redefinition). This rule MUST NOT redefine
`P-NAPP-025`'s decision schema, MUST NOT extend the
`review.decision` closed enum, MUST NOT extend the
`adjudicator_kind` enum, and MUST NOT introduce a parallel review
record that differs from the admitted descriptor's review block.
Decision schema ownership remains with `P-NAPP-025`; evidence shape
ownership remains with `P-AUDIT-006`; this accessor projects them
verbatim. Collapsing any two of the four typed fields into one
accessor field is a forbidden parallel-truth projection.

`MUST NOT` (no upstream-evidence accessor here). This accessor
exposes the `P-NAPP-025` decision schema. It MUST NOT expose the
three upstream audit-evidence references (`audit_evidence_ref`,
`ai_audit_model_ref`, `scanner_results_ref`) under this rule;
upstream evidence-record consumer surfaces are out of scope for this
rule. The Apps-surface "review status"
projection per `PI-W3-34` reads the terminal decision record; the
upstream evidence chain consumed by `P-AUDIT-006` is not part of the
first-level Apps display.

Cross-references: `P-NAPP-025` (review-decision schema; not
redefined), `P-AUDIT-006` (review-evidence shape; not redefined),
`K-APP-017` (launch gate authority; not driven by this accessor),
`P-AUDIT-001` (admission gate authority; not driven by this
accessor), `S-PERM-010` (anti-target rule recording that the
review-evidence accessor is NOT in S-PERM), parent invariants
`PI-W3-34`, `PI-W2-21`, `PI-W2-22`.

## S-APP-016 — Generated-App Runtime Platform Client Auth Helper

**Background fact.** Platform `P-SCAF-*` admits Nimi app scaffolding and
requires generated apps to consume SDK/Runtime auth/session authority without
self-declaring first-party status, owning tokens, or calling Realm login routes.
Runtime `K-ACCSVC-*` owns local account truth and the local-app operation
coordinator; `K-APP-*` owns local principal/record truth; `K-GRANT-*` owns local
grant truth; `K-PLOCAL-*` owns launch leases and process-bound sessions. The
helper consumes the final host-injected carrier and must not merge those owners.

`MUST` (exported names). SDK admits the root `createNimiClient` composition
path for generated Nimi app auth/client construction. The local-app branch
returns only the bounded local-app surface and admits these exact public names:

- `createNimiClient`;
- `NimiClientConfig`;
- `NimiClientLocalAppConfig`;
- `NimiLocalAppClient`;
- `NimiLocalAppStandardShell`;
- `NimiAppAuthMode`;
- `NimiAppAuthProjection`;
- `NimiAppAuthUnavailable`;
- `NimiAppLocalSessionProjection`.

`MUST` (mode set). `NimiAppAuthMode` is a closed mode set:

- `local-first-party-app`;
- `local-app`.

`MUST` (`local-first-party-app`). This value is available only to the retained
bundled first-party composition. It cannot be selected by a third-party app,
project, manifest, fixture or mode string and cannot be inferred from Desktop
launch. Shipped Zhiyu/Avatar remain bundled; an isolated Zhiyu integration build
uses `local-app` instead.

`MUST` (`local-app`). This value maps only to Runtime `LOCAL_APP`. The SDK
receives a host-injected typed standard-shell carrier and projects session
status, public permission posture/request, and app-private JSON storage. It never receives principal/record/permission-decision
identifiers, launch material, process proof, endpoint, bearer or authorization
metadata. A valid session is projected as session-bound independently of every
permission; base entitlements may work while protected permissions remain
unavailable.

`MUST` (projection). `NimiAppAuthProjection` must distinguish session-bound,
action-required, revoked, project-changed, process-replaced, account-changed,
Runtime-restarted, and unavailable states. Permission posture is exposed only
through the separate product permission client and never changes the session
state. `NimiAppAuthUnavailable` is the typed
fail-closed branch for absent carrier, failed principal/record resolution,
custody unavailable, or unavailable operation owner.

`MUST NOT` (no app-owned auth truth). No mode may accept app-owned access
tokens, refresh tokens, session stores, subject providers, direct Realm login
credentials, refresh-token providers, raw JWTs, decoded subject fields, or any
app-controlled token custody as input.

`MUST NOT` (no Realm login bypass). Generated third-party/developer auth must not call
`/api/auth/login`, `/api/auth/refresh`, SDK Realm login routes, or direct Realm
token exchange as app auth truth. Realm data access, when later admitted for a
caller, must come through an exact Runtime-owned protected operation. No mode,
including first-party local composition, has a short-lived token exception.

`MUST NOT` (no pseudo-success). `local-app` must not use mock auth, disabled
gates, anonymous subject fallback, fixture-mode success, direct daemon access,
or first-party self-declaration. It must not become
`local-first-party-app` by setting a mode string, app id, app instance id,
workspace profile, package metadata or Desktop launch metadata.

Cross-references: `P-SCAF-002` (A2/A4 final local-app split),
`P-SCAF-008` (generated app authoring command
family), `K-ACCSVC-001..K-ACCSVC-021` (Runtime account/session custody and
deny-all public-token boundary), `K-BIND-001..K-BIND-015` (scoped app binding
authority), `K-APP-017` (launch authority), `P-NAPP-013` / `P-NAPP-018`
(public admission and descriptor authority; not redefined).

## S-APP-017 — App Storage Partition Projection

`MUST`：the general Runtime facade may expose a typed storage projection only to
an independently admitted host/owner caller backed by Runtime `GetAppStorage`
(`K-APP-022`). For `LOCAL_APP`, the final `standardShell` carrier does not expose
`GetAppStorage`, absolute roots, or a storage-root accessor. Runtime and the
native host re-key private storage by the inherited principal/session context;
the app observes no principal id and cannot request any root.

The 0K checkpoint admits exactly `storage.readJson`, `storage.writeJson`, and
`storage.removeJson` on the protected local-app carrier. SDK exposes them as
`storage.readJson(relativePath)`, `storage.writeJson(relativePath, value)`, and
`storage.removeJson(relativePath)`. These calls are the `app.private_storage`
base entitlement, not public permissions. Each call is bound to the exact
current principal/session/account partition and canonical relative JSON path;
no permission row, prompt, owner selector or grant participates. Runtime
enforces a 240-byte canonical relative `.json` path, a
256 KiB document bound, a 16 MiB principal-partition quota, symlink/non-regular
file rejection, and idempotent remove. The SDK projects only JSON value,
`sizeBytes`, or `removed`; it rejects any root/path/authority field.

`data.pathResolve`, generic file operations, directory operations, binary
storage, caller-selected quota/root, and every other `storage.*` operation
remain typed unavailable.

`MUST NOT`：SDK must not read `<runtime_owner_state_root>/nimi.json`, parse Runtime config, or
concatenate `<nimi_data>/apps/<app-id>` as a local fallback. It must not accept
app id, project path, renderer metadata, manifest data, or an app-supplied
principal as a storage selector. Enforcement and storage truth remain
Runtime-owned.

## S-APP-018 — App Package Readiness Accessor

`MUST`：SDK must expose typed app package readiness access backed by Runtime
`GetAppPackageReadiness` (`K-APP-023`). In 0K, immutable package/install/update/
promotion readiness returns typed unavailable while preserving opaque lineage,
attestation, revision, execution-profile and digest slots inside Runtime. SDK
must not expose those opaque internal refs as a positive package assertion.

`MUST NOT`：SDK must not scan Runtime-owned install-evidence files, infer
package readiness from file existence, or treat Desktop / Kit bridge evidence
as canonical package truth. SDK orchestration here is non-authoritative: it
submits explicit typed requests to Runtime and maps the Runtime projection
without hiding fail-closed states.

## S-APP-019 — Account App-Inventory Truth Accessor

`MUST`：SDK exposes typed access, request builders, response parsers, and
decoders for Runtime `GetAccountAppInventory` (`K-APP-024`). The Runtime
request carries no app- or renderer-supplied `account_id`; Runtime resolves the
authenticated account binding and validates the projection.

`MUST`：account visibility and local record state remain separate. 0K local
states are `not-present`, `local-record-active`, `local-record-dormant`, and
`removed`; immutable package install state is unavailable until 0P/P. An
account verified row without local materialization remains a valid catalog row.

`MUST NOT`：SDK must not read
`~/.nimi/accounts/<account-id>/apps/inventory.json`, infer account directories,
or convert absent/corrupt inventory state into success. SDK helpers may
preserve the explicit `exists=false` response and parse present records, but
Runtime owns account app-inventory validation, writes, and fail-closed reason
codes.

## S-APP-020 — Unified Apps Inventory Composition

`MUST`：`NimiAppClient.list()` returns `NimiAppInventoryEntry[]`. Each entry
MUST carry:

- `appId` and display metadata;
- `sources.catalog?`, `sources.account?`, and `sources.local?`;
- closed `trustTier`, `installState`, `openReadiness`, `activeJobs[]`,
  `nextActions[]`, and typed `reasonCode/detail`.

`MUST`：catalog/account composition is deterministic by `appId`; distinct local
records are deterministic by their Runtime-issued opaque record reference and
must not merge merely because their display `appId` matches. A source failure is emitted as
a typed source-degraded projection and MUST NOT fabricate entries from another
source. Valid entries from other sources may remain visible only with the
source-degraded reason preserved.

`MUST NOT`：SDK must not collapse account entitlement, local records, and
ordinary catalog admission into a single boolean `installed` or `ready`; it
must not infer account visibility from install evidence or infer a local record
from file existence.

## S-APP-021 — Local App Record Projection

`MUST`：SDK exposes read-only typed status for the current host-injected
local-app carrier: trust class, record state, session state, public permission posture and
typed reason. The projection omits `local_app_principal_id`, lineage, SID
partition, launch/process/session identifiers, permission-decision identifiers/revisions,
digests and provenance-attestation refs.

`MUST NOT`：SDK exposes no workspace-adoption, install, import, promote or
repair accessor in 0K.
Immutable positive package materialization remains typed unavailable until 0P/P.
SDK/Desktop/apps must not scan workspaces or infer a record from a manifest,
path, app id or file existence.

## S-APP-022 - Local App Bootstrap Custody Boundary

`MUST`: the local-app SDK bootstrap accepts exactly one host-neutral
`standardShell` input and exposes only bounded session status, product-facing
permission status/request, and Nimi-mediated app-private JSON storage. A valid
session may use base entitlements without any permission. Protected
Nimi/Realm/Agent/Cognition operations remain unavailable until their complete
public-permission slice is admitted.

`permissions.status` and `permissions.request` map only to Runtime
`GetLocalAppPermissionStatus` and `RequestLocalAppPermission`. They carry a
public `permissionId` plus a bounded user-facing reason and return only
`permissionId`, public posture, `canRequest`, and a typed reason. They never
carry internal operation/resource identity or return request/challenge/grant/
principal/record identifiers, and cannot approve, revoke, enumerate grants, or
proxy an Account method.

`MUST NOT`: SDK input/output must not contain Runtime or Realm clients, account
caller posture, local-app principal/record/permission-decision ids, launch binding/nonce,
launch host, release/capability refs, app session metadata, endpoint,
authorization, credential, ordinary gRPC, generic method-id/bytes forwarding,
or developer-registration fallback. Missing/unadmitted carrier or unavailable
permission is a typed fail-closed result and cannot be replaced by renderer
metadata. App-native SQLite, media, settings, cache, routes and product commands
remain outside this Runtime permission client.

Cross-references: `P-SCAF-016` (scaffolded local-app binding custody),
`K-ACCSVC-022` / `K-ACCSVC-026` (local-app caller and operation posture),
`K-APP-017` (Runtime local-app launch authority), `P-KIT-044`
(local-app standard shell capability set).

## S-APP-023 - Desktop Open Intent Data Surface

`MUST`: SDK `@nimiplatform/sdk/app` exposes `NimiDesktopOpenIntent`,
`NimiDesktopOpenEnvelope`, parser, and type guard surfaces for the Platform
`P-DOPEN-*` Desktop Open Intent protocol.

`MUST`: SDK is the TypeScript semantic parser owner for Desktop Open Intent.
SDK parser behavior must match
`scripts/testdata/desktop-open-intent-golden-vectors.yaml`.

`MUST NOT`: SDK must not expose an opener, import Kit, Electron, Tauri, browser
globals, OS opener code, Desktop private bridge code, or Runtime private
boundaries. Apps call Desktop Open Intent through Kit standard shell hosts, not
through SDK.

`MUST NOT`: SDK Desktop Open Intent data must not carry auth/session/token,
provider/model/connector credential truth, Runtime caller identity, or
executable LocalAgent truth.

Cross-references: `P-DOPEN-*`, `P-KIT-045`, `D-IPC-018`, `D-SHELL-039`.

## S-APP-024 - Protected Local-App Selected Voice Client

The local-app runtime platform client exposes exactly two additional Agent
methods from `K-VOICE-021`:

- `agent.transcribeVoice({ agentId, clientRequestId, audio, mimeType })`
- `agent.subscribeVoiceStream({ agentId, conversationAnchorId, turnId,
  voiceStreamId, cursor? })`

`transcribeVoice` accepts only a `Uint8Array` up to 8 MiB and the closed Runtime
audio MIME set. It returns only `{ clientRequestId, text }`, with transcript text
bounded to 64 KiB UTF-8. `subscribeVoiceStream` returns one correlated page with
an opaque cursor and exactly one typed Runtime voice event; chunk bytes are
decoded to `Uint8Array`, and every event must match all caller-supplied
agent/anchor/turn/voice-stream selectors. A terminal event ends consumption.

The SDK and Kit carrier must reject model, connector, provider, target ref,
route policy, fallback, prompt, language, diarization, timestamps, response
format, timeout, label, extension, principal, account, grant, session, endpoint,
or token fields before dispatch. They must not construct `ExecuteScenario`,
`SubmitScenarioJob`, generic Runtime unary/stream calls, realtime sessions, or a
provider fallback. Missing protected carrier, grant, committed Runtime Agent AI
Config intent/readiness, conversation correlation, or stream truth fails closed
with the typed local-app error envelope.

These methods carry data only. Runtime owns local-app authorization, AI route,
job execution, stream truth, artifacts, and audit; the SDK owns no route cache,
voice truth, credential, playback state, or durable audio bytes.

## Fact Sources

- `.nimi/spec/sdks/feature-clients.authority.yaml` — `S-AICONF-001..S-AICONF-006`
- `.nimi/spec/sdks/feature-clients.authority.yaml` — `S-RUNTIME-119`
- `.nimi/spec/sdks/client-core.authority.yaml` — `S-SURFACE-*`
- `.nimi/spec/sdks/client-core.authority.yaml` — `S-ERROR-*`
- `.nimi/spec/sdks/feature-clients.authority.yaml` — `S-PERM-001..S-PERM-010` (`S-PERM-010` records the S-APP-vs-S-PERM placement anti-target for the review-evidence accessor admitted at `S-APP-015`)
- `.nimi/spec/platform/app-ecosystem.authority.yaml` — `P-NAPP-001..P-NAPP-029`, `P-NAPP-033..P-NAPP-034` (`P-NAPP-015` storage policy, `P-NAPP-018` catalog descriptor shape, `P-NAPP-019` opaque immutable-package slots, `P-NAPP-025` review-decision schema, `P-NAPP-027`/`P-NAPP-028` storage posture, `P-NAPP-034` protected local-app launch)
- `.nimi/spec/platform/app-ecosystem.authority.yaml` — `P-NAPP-030..P-NAPP-032`, `P-NAPP-035..P-NAPP-036` (`P-NAPP-030` listing closure, `P-NAPP-031` unified inventory, `P-NAPP-032` local record creation boundary, `P-NAPP-035..036` local-app development/principal kernel)
- `.nimi/spec/platform/app-ecosystem.authority.yaml` — `P-PERM-001..P-PERM-011` (`P-PERM-002` closed scope enum, `P-PERM-006` cross-app authorization, `P-PERM-011` `app-local-drafts` qualifier semantics)
- `.nimi/spec/platform/app-ecosystem.authority.yaml` — `P-AUDIT-001..P-AUDIT-006` (`P-AUDIT-006` review-evidence shape)
- `.nimi/spec/platform/app-ecosystem.authority.yaml` — `P-MOEX-001..P-MOEX-006`
- `config/platform-nimi-app-registry.yaml`
- `config/platform-nimi-app-trust-tiers.yaml`
- `.nimi/spec/platform/core-protocol.authority.yaml` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/platform/core-protocol.authority.yaml` — `P-AISC-001..P-AISC-007`
- `.nimi/spec/runtime/local-compute.authority.yaml` — `K-LENG-024..K-LENG-027`
- `.nimi/spec/runtime/local-compute.authority.yaml` — `K-LENG-028`
- `.nimi/spec/runtime/app-surface.authority.yaml` — `K-APP-014` (uninstall lifecycle), `K-APP-017` (launch gate), `K-APP-018` (Runtime-mediated file-API non-admission)
- `.nimi/spec/runtime/app-surface.authority.yaml` — `K-APP-022` (principal-keyed app storage), `K-APP-023` (opaque package seam), `K-APP-024` (account/local record inventory), `K-APP-025` (retired adoption path)
- `.nimi/spec/runtime/protected-session.authority.yaml` — `K-ACCSVC-*` (Runtime account/session custody, local-app coordinator and removed public-token boundary consumed by `S-APP-016`)
- `.nimi/spec/runtime/app-surface.authority.yaml` — `K-BIND-*` (Runtime-issued scoped app binding authority consumed by `S-APP-016`)
- `.nimi/spec/platform/app-ecosystem.authority.yaml` — `P-SCAF-*` (generated-app helper naming, final local-app mode and no first-party self-declaration consumed by `S-APP-016`)
- `.nimi/spec/platform/core-protocol.authority.yaml` — `P-DOPEN-*`
- `scripts/testdata/desktop-open-intent-golden-vectors.yaml`
- `.nimi/spec/runtime/model-catalog.authority.yaml` — `K-VOICE-021`

---

<!-- source: .nimi/spec/sdks/kernel/nimi-permission-client-contract.md -->

# SDK Nimi Permission Client Contract

> Owner Domain: `S-PERM-*`

## Scope

定义 SDK 对 Platform `P-PERM-*` product-facing permission catalog 的唯一
app-facing typed projection。本契约只覆盖第三方 app 访问 Nimi、Realm、Agent
或 Cognition owner 资源时的用户权限；base entitlement、first-party product
operation、app-owned authority 与 OS right 明确不属于本 client。

## S-PERM-001 — Sole Public Permission Path

`MUST`：当某个 `P-PERM-017` permission slice 完整准入后，SDK permission
client 是 app 查询自身 posture、发起用户可理解请求和订阅自身 posture 变化的
唯一 public path。Transport 必须由 Kit/native host 注入，并从 protected carrier
派生 app、account、principal 与 OS-user identity。

`MUST NOT`：app 不得直接调用 Realm grant REST、Runtime private grant RPC、
Cognition private endpoint，或经 bridge implementation detail 读写 grant ledger。

## S-PERM-002 — Minimal Product Operation Set

SDK logical surface 固定为：

- `permission.status(permissionId)` — 返回 calling app 对该 public id 的一个
  public posture。
- `permission.request({ permissionId, reason })` — 发起一次 public permission
  request；需要 selector 时由 owner-owned picker 接管。
- `permission.subscribe(permissionId, callback)` — 订阅 calling app 对该 id 的
  public posture 变化。

普通 app surface 不暴露 `list(scopeRef)`、`get(grantId)`、`revoke(grantId)`、
grant history、raw lifecycle 或 other-app rows。用户撤销与审计管理属于 Desktop
Settings；未来若 admit app-initiated release，必须作为独立 public semantic
operation 准入，不得复用 raw grant id。

## S-PERM-003 — Public Request Shape

`MUST`：request input 精确为 `{ permissionId, reason }`。`reason` 是 bounded、
面向用户的说明，不是 authority。App/account/principal/session/OS-user anchor 从
protected carrier 派生；selector 与 selector digest 从 catalog 指定的 owner picker
派生。

`MUST NOT`：public SDK input/type/export 不得出现 `AIScopeRef`、`scopeFamily`、
`scopeName`、`qualifier`、`operationId`、`resourceRef`、`grantId`、raw account/
principal/session、token 或 credential。

## S-PERM-004 — Closed Catalog And Current Admission

`MUST`：`PermissionID` 仅包含
`nimi-app-permission-catalog.yaml#public_permissions` 的稳定 product ids。
只有 `admission: admitted` 且 `manifest_allowed: true` 的 id 可进入
`request(...)`。Known-but-reserved id 可用于 `status(...)` 的 typed
`unavailable` projection，但 request 必须在调用 transport 前 fail closed。

当前没有已准入的第三方 public permission；因此 current SDK request positive
set 为空。该状态不影响 app 启动、私有存储、host commands 或 app-owned UI。

## S-PERM-005 — Public Posture, Not Grant Lifecycle

`MUST`：app-facing posture 闭集为 `prompt | pending | granted | denied |
unavailable`，并至少返回 `{ permissionId, posture, canRequest }`。Transport
返回未知值、mismatched id、reserved id 的 positive posture，或缺失字段时 SDK
必须 fail closed。

`MUST NOT`：owner lifecycle 的 `expired | revoked | superseded`、revision、
fingerprint 与 transition history 不得成为 ordinary app API。SDK 不得把 missing
record、transport error 或 reserved id 投影为 `granted`。

## S-PERM-006 — No Fallback Or Parallel Ledger

失败必须返回 typed actionable error。SDK 不得提供 `{ fallback: 'allow' }`、
默认 scope、implicit current app、client-side optimistic grant、offline allow、
Realm/Runtime 双 ledger 合并，或把 publish/review trust 当作 permission。

## S-PERM-007 — Public/Internal Enforcement Separation

一个 public permission 可由 owner 映射到多个 exact operations、resource checks、
quota、budget、rate、presence 与 audit events；这些映射保留在 owner backend。
SDK/renderer 只见 public id、reason、public posture 与 owner-hosted picker flow，
不得按 method、anchor、turn、stream 或 app-private file 逐项申请。

## S-PERM-008 — One-Shot And Cross-App Non-Admission

`files.open`、`files.save`、`artifacts.open` 与 `shared_resources.open` 当前均为
reserved one-shot rows。Owner picker、non-forgeable handle、consume semantics 与
audit 未原子准入前，SDK 不得暴露 callable file/cross-app shortcut、target app id、
path 或 generic durable grant。

## S-PERM-009 — App-Private Authority Exclusion

Nimi-mediated private JSON storage 是 `app.private_storage` base entitlement；
app 自建 SQLite、media、settings、cache、routes 和 exact native commands 是
`app_owned_authority`；普通 filesystem/network/process/device authority 是
`os_right`。三者均不得进入 `PermissionID`、manifest permission request、grant
ledger 或用户批准 UI。

SDK storage/host-command helpers 仍必须依赖 live protected carrier、opaque
principal/account partition、path/quota/symlink/origin/payload checks；“不是用户
permission”不等于“没有安全边界”。

## S-PERM-010 — Review Evidence Is Not Permission

Release review/attestation accessor 属于 `S-APP-*` admission evidence surface，
不得出现在 permission posture、permission request、subscription 或 owner grant
lifecycle。`approved | revision-requested | rejected | kill-switched` 与 public
permission posture/lifecycle 是互斥词汇；review 结果不得 seed 或扩大 grant。

## Fact Sources

- `.nimi/spec/platform/app-ecosystem.authority.yaml` — `P-PERM-001..P-PERM-017`
- `config/platform-nimi-app-permission-catalog.yaml`
- `.nimi/spec/platform/app-ecosystem.authority.yaml` — `P-NAPP-*`
- `.nimi/spec/runtime/app-surface.authority.yaml` — `K-APP-*`
- `.nimi/spec/sdks/feature-clients.authority.yaml` — `S-APP-*`
- `.nimi/spec/sdks/client-core.authority.yaml` — `S-ERROR-*`

---

<!-- source: .nimi/spec/sdks/kernel/nimi-proposal-intake-client-contract.md -->

# SDK Nimi Proposal Intake Client Contract

> Owner Domain: `S-PROP-*`

## Scope

This contract defines the SDK typed consumer surface for Platform proposal
intake admitted by `P-PROP-*`. The SDK owns the client shape, validation,
fail-closed behavior, and app-facing projection. Platform remains the
proposal-intake authority; the SDK does not own admission, execution, install,
permission grants, or review truth.

## S-PROP-001 - Sole SDK Access Path

`MUST`: Apps that create or read conversation-originated proposal intake
records MUST go through the SDK proposal-intake client surface. Direct
app-level REST calls, local files, renderer storage, private Runtime imports,
or app-local proposal stores are not admitted.

`MUST NOT`: The SDK surface MUST NOT expose an app-local bypass for Zhiyu or
any other first-party app.

## S-PROP-002 - Logical Operation Set

`MUST`: The SDK proposal-intake client admits these logical operations:

- `proposal.create(draft)` submits a typed proposal draft to the Platform
  proposal operation and returns a typed proposal intake record;
- `proposal.get(proposalId)` MAY read a proposal record when the Platform
  operation is available;
- `proposal.transition(proposalId, transition)` MAY submit an owner-reviewed
  state transition when the Platform operation is available.

`MUST NOT`: These operations MUST NOT install, execute, download, register,
grant permission, run code, select provider/model, or promote release state.

## S-PROP-003 - Record Shape Mirrors Platform Authority

`MUST`: SDK proposal records MUST preserve the `P-PROP-002` field set as
typed SDK fields: `proposalId`, `proposalKind`,
`sourceConversationAnchorId`, `requesterSubjectRef`, `ownerDomain`,
`requestedCapabilityRef`, `riskTier`, `requiredPermissionRefs`,
`nextReviewStep`, `state`, `reasonCode`, `auditRef`, and `createdAt`.

`MUST NOT`: The SDK MUST NOT collapse owner, risk, permission, next review
step, state, or audit fields into a generic text blob.

## S-PROP-004 - Closed Enum Preservation

`MUST`: The SDK MUST preserve the closed `P-PROP-003` proposal kind set and
the closed `P-PROP-004` state set as typed unions or equivalent enums.

`MUST NOT`: The SDK MUST NOT accept unknown kinds or states as opaque strings.
Unknown values fail closed.

## S-PROP-005 - Missing Platform Operation Fails Closed

`MUST`: When no Platform proposal operation is available, SDK
`proposal.create`, `proposal.get`, and `proposal.transition` MUST fail closed
with a typed SDK error. They MUST NOT synthesize a durable proposal record,
audit reference, or state transition.

`MUST NOT`: The SDK MUST NOT fabricate `proposalId`, `auditRef`, or
`accepted-for-admission` state to make a UI path appear successful.

## S-PROP-006 - Retired Alias And Non-Execution Guard

`MUST`: The SDK MUST reject drafts and returned records that try to route a
proposal through a retired `P-MOEX-*` alias family unless the proposal kind is
`rejected_request` or the state is `blocked` / `rejected` with a typed reason.

`MUST`: The SDK MUST reject drafts and returned records carrying execution,
provider/model, install, download, local path, or hidden command fields.

`MUST NOT`: The SDK MUST NOT turn a proposal into executable Runtime,
Workflow, app, package, or delegated-tool behavior.

## S-PROP-007 - Source Conversation Boundary

`MUST`: The SDK proposal draft MUST require `sourceConversationAnchorId` and
`requesterSubjectRef`. The SDK may carry a bounded
`requestedCapabilityRef`, but raw prompt transcript, private memory, provider
trace, or local app state is not proposal truth.

`MUST NOT`: The SDK MUST NOT store conversation bodies or app private state in
the proposal record.

## S-PROP-008 - App Consumer Projection Boundary

`MUST`: SDK consumers must render proposal state from the SDK returned record
or typed SDK error. An app may show a draft/capture UI, but durable proposal
truth remains the Platform-returned record.

`MUST NOT`: Apps must not persist alternate proposal truth, alternate review
state, or hidden success state when the SDK returns a fail-closed error.

---

<!-- source: .nimi/spec/sdks/kernel/connector-auth-acquisition-contract.md -->

# SDK Connector Auth Acquisition Contract

> Owner Domain: `S-RUNTIME-*`

## Scope

定义第三方 managed OAuth acquisition 的 SDK/host typed facade 边界。该契约只覆盖
provider browser/device-code acquisition orchestration；Runtime ConnectorService
继续只拥有 sealed credential custody、connector create/update/probe/consume、以及
provider-native execution header derivation。

## S-RUNTIME-120 Host Connector Auth Acquisition Facade

SDK 可以提供 `runtime.connectorAuth.acquireManagedCredential(...)` 或等价 host
typed facade，用于把 provider browser/device-code flow 收敛出 Desktop renderer。

固定边界：

- facade owner 是 SDK host typed surface，不是 Runtime daemon RPC。
- Runtime 不新增 `AcquireManagedCredential`、`BeginProviderOAuth`、
  `RefreshManagedCredential` 或等价 connector RPC；`K-RPC-003` 的 ConnectorService
  method freeze 继续有效。
- facade 必须通过 adapter 注入 host primitives：browser open、profile-scoped
  provider network request、authorization-code token exchange、sleep/time
  source、以及 Runtime connector create/update client。
- provider network request 必须携带 `profileId` 和 purpose
  (`device_authorization` / `device_token`)；host 必须 fail closed，且只能放行
  `tables/connector-auth-acquisition-profiles.yaml` 为该 profile 生成的 exact
  endpoint。SDK 不得要求 host 暴露 arbitrary provider proxy / generic CORS
  bypass。
- SDK 不得 import Desktop、Tauri、renderer bridge、或 provider UI component。
- host adapter 返回的 sealed credential payload 只能经 existing Runtime
  `CreateConnector` / `UpdateConnector` write path 写入；不得建立第二条 credential
  persistence path。

## S-RUNTIME-121 Acquisition Profile Truth

OAuth acquisition constants 的唯一 SDK-side source 是
`tables/connector-auth-acquisition-profiles.yaml`。

该表只允许承载 acquisition metadata：

- `profile_id`
- `provider_auth_profile`
- `issuer`
- `client_id`
- `device_authorization_url`
- `device_token_url`
- `redirect_uri`
- `fallback_verification_url`
- `token_exchange_provider`
- `default_poll_interval_seconds`
- `min_poll_interval_seconds`
- `default_expires_in_seconds`

该表不得承载 sealed credential payload schema、refresh-token semantics、
provider execution header derivation、connector status truth、model/catalog truth、
或 Runtime-owned credential validation truth。
`token_exchange_provider` 只用于 host-injected authorization-code exchange adapter
routing；它不得被解释为 Runtime execution provider、model/catalog owner、或 header
derivation truth。

## S-RUNTIME-122 Refresh / Rotation Deferral

W1 admitted managed OAuth acquisition 不拥有 refresh / rotation automation。

- Refresh token may appear inside provider-defined sealed `credential_json` only as
  opaque payload material written through existing Runtime connector create/update path.
- SDK host facade must not silently refresh, rotate, rewrite, or repair sealed
  credential payload after acquisition completes.
- Runtime consume/probe must continue to fail closed on unusable managed payloads as
  defined by `K-CONN-018`.
- Re-authentication is manual reacquire unless a future spec redesign explicitly admits
  refresh / rotation owner, storage semantics, audit events, and failure behavior.

---

<!-- source: .nimi/spec/sdks/kernel/local-environment-projection-contract.md -->

# SDK Local Environment Projection Contract

> Owner Domain: `S-RUNTIME-*`

## S-RUNTIME-119 Runtime Local Environment Projection

SDK may expose typed projection for Runtime local environment plans only as a
downstream mirror of Runtime truth. The Runtime authority sources are
`.nimi/spec/runtime/local-compute.authority.yaml`
`K-LENG-024` through `K-LENG-027`,
`.nimi/spec/runtime/local-compute.authority.yaml`
`K-LENG-028`, and the local environment tables under
`config/runtime-*.yaml`.

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

---

<!-- source: .nimi/spec/sdks/kernel/runtime-route-contract.md -->

# SDK Runtime Route Contract

> Owner Domain: `S-RUNTIME-*`

## S-RUNTIME-000 Runtime Target Identity v2 Hard Cut

Runtime route APIs consume v2 durable target refs, return inventory projection
for options, and expose resolved execution binding for execution/describe
truth. Legacy route bindings, `localModelId`, and raw provider/model ids must
not be used as durable target identity.

## Scope

定义 app-facing `runtime.route.*` typed surface，覆盖 host typed surface 以及 `runtime.route.describe(...)` 的 SDK projection 边界。

## S-RUNTIME-074 App-Facing Route Typed Surface

SDK app-facing route facade 固定暴露以下 logical operation：

- `runtime.route.listOptions(...)`
- `runtime.route.resolve(...)`
- `runtime.route.checkHealth(...)`
- `runtime.route.describe(...)`

其中：

- `runtime.route.describe(...)` 在 Phase 1 的 stable authority home 是 host typed surface。
- 本轮不得把 `describe(...)` 定义成 direct daemon convenience method，也不得要求 `new Runtime()` 必须具备与 daemon 顶层 RPC 一一对应的 `describe()`。
- `describe(...)` 相关类型和值域必须直接继承 `K-RPC-015` ~ `K-RPC-021`（`rpc-route-describe-contract.md`），不得在 SDK 再发明第二套 route metadata schema。
- Phase 1 host typed surface 若通过 `ExecuteScenario` 的 route describe probe
  承载 `describe(...)`，必须只解码 Runtime 写入的
  `x-nimi-route-describe-result` response metadata 并执行 typed result 校验；
  SDK/Desktop 不得把缺失 metadata 转换为默认值或根据 route binding 本地推断
  metadata。

## S-RUNTIME-075 Typed Describe Result Projection

SDK 稳定 typed result `RuntimeRouteDescribeResult` 必须保持以下公共字段：

- `capability`
- `metadataVersion`
- `resolvedBindingRef`
- `metadataKind`
- `metadata`

`metadata` 必须是 discriminated union，Phase 1 variants 继承
`K-RPC-017` 的完整 route metadata family：

- `TextGenerateRouteMetadata`
- `SpeechSynthesizeRouteMetadata`
- `SpeechTranscribeRouteMetadata`
- `VoiceWorkflowVoiceCloneRouteMetadata`
- `VoiceWorkflowVoiceDesignRouteMetadata`

字段和值域必须与 `K-RPC-017` 同形：

- `TextGenerateRouteMetadata.traceModeSupport` 只能是 `'none' | 'hide' | 'separate'`
- `SpeechSynthesizeRouteMetadata.supportedTimingModes` 只能包含 `'none' | 'word' | 'char'`
- `VoiceWorkflow*RouteMetadata.workflowType` 只能是 `'voice_clone'` 或 `'voice_design'`
- 不得把结果降格为 `Struct`、`Record<string, unknown>`、provider raw payload 或自由字符串 map

## S-RUNTIME-076 Fail-Close Projection

SDK 对 `runtime.route.describe(...)` 的稳定消费必须 fail-close：

- 缺失 `metadataKind`
- 缺失 `K-RPC-017` 要求的任一 typed field
- 枚举值超出规范值域
- `capability`、`metadataKind`、`resolvedBindingRef` 三者不一致

发生上述任一情形时，SDK 必须直接报错；不得：

- 回落到 `resolve + checkHealth` 视为 metadata 成功
- 用 provider/model 名称或 local/cloud 假设补猜 `supportsThinking`、`supports*Input`、workflow metadata
- 暴露 product-facing fallback knob 让调用方选择 fail-open

## S-RUNTIME-077 Selection / Resolve / Health Host Projection Boundary

`runtime.route.listOptions(...)`、`runtime.route.resolve(...)`、以及
`runtime.route.checkHealth(...)` 在 Phase 1 的 app-facing stable home 是 SDK
host typed surface。该 surface 只能做 Runtime facts 的 deterministic projection，
不得成为新的 catalog、readiness、provider/model capability、fallback policy、
或 default route policy authority。

允许的 SDK projection 工作固定为：

- 对 Runtime 已投影的 local asset / provider catalog / connector catalog / capability
  record 做类型收窄、字段归一化和 fail-close 校验。
- 在已存在的 typed binding intent 或 Runtime-projected local asset record 上执行
  model-root normalization。
- 在 Runtime 已提供 engine / provider / capability evidence 时，派生 local route
  engine label；不得仅凭 Desktop raw provider/model/endpoint 猜测 engine。
- 基于 Runtime local catalog/readiness projection 选择 warm candidate；该选择只能
  用于同一已解析 local asset 的 warm-on-demand orchestration，不得替代
  `runtime.route.resolve(...)` 的 binding truth。
- 组装 app-facing resolved binding projection，但所有 resolved identity、health、
  readiness 和 capability truth 必须可追溯到 Runtime projection input。

禁止路径：

- 从 Desktop `runtimeFields`、endpoint 字符串、provider label、model label、
  local/cloud heuristic、或 connector 默认模型回填生成 execution route truth。
- 在 SDK 内维护 provider/model catalog、local engine catalog、readiness cache、
  fallback matrix、或 first-available default binding 作为 stable truth。
- 把 `listOptions` 的 option ordering 或 UI convenience selection 升级为
  execution fallback policy。
- 把 `checkHealth` 成功解释为 metadata 成功；metadata 仍必须走
  `runtime.route.describe(...)` 的 `S-RUNTIME-075` / `S-RUNTIME-076` 边界。

## S-RUNTIME-078 Runtime Client Projection Boundary

`@nimiplatform/sdk/runtime` 在 Phase 1 可以共享 `runtime.route.describe(...)` 的 typed result types，但不得把它包装成“新增 daemon 顶层 RPC 已存在”的公开承诺。

- 允许共享类型与 host facade interface。
- 不允许在 runtime client surface 上引入与 `K-RPC-020` 冲突的 transport 假设。
- 在 runtime transport authority 正式定稿前，route metadata 的 app-facing 成功路径以 host typed surface 为准；SDK 不得先行发明私有临时 API。
- route facade 可能被 host/runtime memory binding 解析路径复用作 legality /
  health dependency，但 `runtime.route.*` 本身不是 memory embedding editable
  config surface，也不是 canonical bank bind / cutover command surface。

---

<!-- source: .nimi/spec/sdks/kernel/runtime-delegation-client-contract.md -->

# SDK Runtime Delegation Client Contract

> Owner Domain: `S-RUNTIME-*`

The SDK consumes Runtime Delegated Capability Gateway state as typed
projections and command envelopes. It does not own Runtime delegation
semantics, approval policy, provider lifecycle, credentials, firewall verdicts,
or audit truth.

## S-RUNTIME-201 Delegation Client Boundary

SDK may expose Runtime delegation APIs only as typed clients for Runtime-owned
contracts:

- External Agent gateway/status/token/action/audit projection
- provider profile projection
- provider lifecycle projection
- delegated session projection
- delegated request projection
- delegated result projection
- firewall verdict projection
- approval request and decision projection
- audit/replay projection

SDK must not expose protocol-native MCP or A2A wire objects as stable public
Nimi types.

## S-RUNTIME-202 Provider Projection

Provider projection fields must align to `K-DELEG-002` through `K-DELEG-007`.

SDK may expose display and status fields, but it must not expose raw connector
credentials, authorization headers, provider secret material, or adapter-local
handles.

## S-RUNTIME-203 Delegation Request Projection

Delegation session projection must align to `K-DELEG-020` through
`K-DELEG-021`. Delegation request projection must align to `K-DELEG-030`
through `K-DELEG-032`.

SDK consumers may observe request state and submit Runtime-owned commands. They
must not mutate request internals by local object replacement.

External Agent action descriptors, issue/revoke/list token operations,
execution context verification, completion, and audit replay are Runtime-owned
commands/projections. SDK may expose typed methods for them; it must not
preserve Desktop/Tauri command names or retired extension-specific identity
fields.

## S-RUNTIME-204 Delegation Result Projection

Delegation result projection must align to `K-DELEG-040` through `K-DELEG-046`.

SDK must distinguish provider completion from firewall acceptance. A completed
provider result is not accepted Runtime context until a firewall verdict exists.

## S-RUNTIME-205 Firewall Projection

Firewall projection must align to `K-DELEG-050` through `K-DELEG-084`.

SDK must expose verdict, reason, confidence, provenance, and quarantine state
as typed fields. It must not expose raw quarantined payload by default.

## S-RUNTIME-206 Approval Projection

Approval projection must align to `K-DELEG-090` through `K-DELEG-099`.

SDK approval methods submit typed Runtime decisions. They do not own approval
policy and cannot auto-approve outside Runtime policy.

## S-RUNTIME-207 Audit Replay Projection

Audit and replay projection must align to `K-DELEG-085` through `K-DELEG-089`
and `K-AUDIT-*`.

SDK may expose replay views, but it must preserve redaction, access control,
and invalid-lineage failure states.

## S-RUNTIME-208 Type Escape Prohibition

Delegation SDK types must use named interfaces, enums, tagged unions, or
schema-bound references. Stable SDK delegation contracts must not use untyped
catch-all fields for provider output, protocol metadata, or adapter-specific
payloads.

Protocol evidence may be represented only by typed evidence refs and
protocol metadata fields admitted by `K-DELEG-044`.

## S-RUNTIME-209 Consumer No-Bypass

SDK must not provide helper APIs that connect Desktop, Avatar, apps, Web, or
direct consumers directly to MCP/A2A providers. All delegated operations must route through
Runtime-owned gateway APIs.

## S-RUNTIME-210 Implementation And Consumer Availability Boundary

This contract admits the SDK typed delegation contract only. SDK
implementation methods, generated clients, Desktop/Avatar/app consumers,
provider configuration UX, approval UX, and replay UX require their own
admitted implementation and tests before support is claimed. Until those gates
exist, SDK may not claim production delegated provider configuration,
approval, or replay support.

## Traceability

`S-RUNTIME-201` through `S-RUNTIME-210` define one SDK projection family for
Runtime delegation. The family is a typed contract surface:
`S-RUNTIME-201`, `S-RUNTIME-202`, `S-RUNTIME-203`, `S-RUNTIME-204`,
`S-RUNTIME-205`, `S-RUNTIME-206`, `S-RUNTIME-207`, `S-RUNTIME-208`,
`S-RUNTIME-209`, and `S-RUNTIME-210` must be consumed by later SDK
implementation admissions without re-owning Runtime delegation semantics.

---

<!-- source: .nimi/spec/sdks/kernel/runtime-avatar-control-client-contract.md -->

# SDK Runtime Avatar Control Client Contract

> Owner Domain: `S-RUNTIME-*`

## S-RUNTIME-112 Avatar Control Client Boundary

SDK may expose Avatar configuration and debug/probe APIs only as typed
clients for the referenced Desktop, Runtime, and Avatar authority contracts.

SDK does not own configuration semantics, probe semantics, backend execution,
or replay truth.

## S-RUNTIME-113 Retired Configuration Projection

SDK avatar configuration methods aligned to the Desktop-owned Agent Center
avatar configuration schema are retired. The Desktop schema is no longer active
semantic authority.

Current selection truth is Runtime `AgentPresentationProfile`, written through
the Runtime Agent presentation mutation surface. Host-local asset custody is a
Kit Shell standard `agent-center` capability surface, not an SDK semantic
configuration record.

The typed SDK Agent record projection carries Runtime's optional presentation
profile and committed presentation revision as separate fields, so a caller can
read the current CAS token even after clear. Set, patch, and clear helpers
require the caller's expected revision,
preserve proto3 optional presence so `false` and empty-string clears remain
distinct from omission in every generated SDK, and surface stale writes as the
typed Runtime conflict rather than retrying or overwriting a newer profile.

SDK request builders and read projections implement the exact positive
bare/qualified opaque-ref grammar from `K-AGCORE-023a`, including its byte
limits, namespace allow/deny rules, percent-decoded validation pass, and
`profile_media_url:https://` restriction. They also reject empty
voice-reference suffixes. These client checks do not replace Runtime
authorization, owner/durability resolution, or atomic validation.

SDK must not reintroduce `runtime.avatarConfiguration.*` as a Desktop-owned
schema facade, compatibility shim, or app-local config store. Opaque refs remain
opaque and must not be dereferenced into Avatar package descriptors or backend
capability profiles.

## S-RUNTIME-114 Probe And Replay Projection

SDK probe methods must align to
`.nimi/spec/runtime/agent-participation.authority.yaml`.

SDK must expose typed request, result, submit-result, and replay ref shapes. It
must not expose raw APML parser diagnostics, backend command strings, provider
payloads, MCP/A2A protocol objects, or raw Avatar backend payloads as stable
public types.

## S-RUNTIME-115 Avatar Evidence Projection

SDK may carry Avatar evidence refs and schema-bound evidence summaries from
`.nimi/spec/avatar/embodiment-surface.authority.yaml`.

SDK must not reinterpret Avatar backend evidence as Runtime success. SDK may
carry `SubmitAvatarDebugProbeResult` envelopes from Avatar to Runtime, but
Runtime probe result status remains the accepted public diagnostic status.

## S-RUNTIME-116 Method Registry

Admitted SDK method names are pinned by
`tables/runtime-avatar-control-methods.yaml`.

Until implementation and test gates exist, these names are contract targets
only and must not be reported as production support.

## S-RUNTIME-117 Type Escape Prohibition

Runtime Avatar control SDK types must use named interfaces, enums, tagged
unions, or schema refs.

Stable SDK contracts must not use:

- `any`
- `Record<string, unknown>`
- free-form maps for provider payloads
- protocol-native MCP/A2A objects
- raw backend command payloads

## S-RUNTIME-118 Consumer No-Bypass

SDK must not provide helper APIs that let Desktop, Avatar, apps, or Web
bypass Runtime-owned probe/replay/authorization semantics or Avatar-owned
backend resolver execution.

## Retired Avatar Package Client Surface

`RETIRED`：SDK Avatar package client surface 已随 Asset Market 撤回一并退役。
原 `runtime.avatarPackage.resolveLaunchProjection`、`decodeAvatarPackageHandoff`、
`RuntimeAvatarPackageHandoff`、`RuntimeAvatarPackageBackendKind` 等公共 SDK
surface 不再存在。本范围保留为退役占位，原 231-239 Avatar package
client rule block 不再承载 active normative 行为。

Avatar 启动只保留本地 Avatar 资产路径（私有 import + 本地 materialization），
不再有远程 package 来源；任何复活该 surface 的提案必须重新立项并写入新规则。

## S-RUNTIME-240 Avatar Live Instance Binding Client

SDK admits `runtime.agent.anchors.registerAvatarLiveInstance` and
`runtime.agent.anchors.resolveAvatarLiveInstance` as the only client methods
that map Desktop/Avatar live-instance recovery to Runtime `K-AGCORE-138`.

Fixed rules:

- registration requires protected `runtime.agent.write`
- resolution requires protected `runtime.agent.read`
- both methods must require local agent identity and explicit
  `avatarInstanceId`
- registration must also require explicit `conversationAnchorId`
- SDK must return Runtime's binding plus `ConversationAnchorSnapshot`; it must
  not infer anchor continuity from same-agent identity or app-local storage

---

<!-- source: .nimi/spec/sdks/kernel/runtime-agent-participation-contract.md -->

# SDK Runtime Agent Participation Client Contract

> Owner Domain: `S-RUNTIME-*`

The SDK consumes Runtime Agent Participation authority as typed clients and
projections. It does not own participation execution semantics, prompt
assembly, provider/model routing, memory promotion, Realm GROUP commit,
cross-profile concurrency, audit truth, or protocol-native MCP/A2A wire truth.

## S-RUNTIME-211 Participation Client Boundary

SDK may expose Runtime Agent Participation APIs only as typed clients for
Runtime-owned `K-AGCORE-061` through `K-AGCORE-088` contracts.

SDK methods submit typed participation requests, read typed profile/context
metadata, observe Runtime-owned output candidates, and read Runtime audit/replay
views. SDK must not construct participation prompts, select AI providers or
models, decide memory/capability/concurrency verdicts, or commit domain
transcripts.

## S-RUNTIME-212 Axis and Profile Projection

SDK participation profile projection must align exactly to the closed axis and
profile registries in:

- `.nimi/spec/runtime/agent-participation.authority.yaml`

SDK must not add open-string axis values, local lane enums, extra named
profiles, or compatibility aliases outside the Runtime registry.

## S-RUNTIME-213 Context Block Projection

SDK context block projection must align to
`.nimi/spec/runtime/agent-participation.authority.yaml`.

SDK consumers may pass typed context block references admitted by Runtime, but
they must not pass raw prompt blobs, raw transcript dumps, raw protocol payloads,
or untyped provider/app-local memory payloads.

## S-RUNTIME-214 Output Candidate Projection

SDK output candidate projection must align to
`.nimi/spec/runtime/agent-participation.authority.yaml`.

SDK must distinguish Runtime execution output from domain transcript commit. For
Realm GROUP participation, SDK may expose a Runtime-owned non-committal
candidate and a Realm-authenticated commit path owned by `R-CHAT-*`; SDK must
not expose Runtime direct GROUP write as a participation helper.

## S-RUNTIME-215 Verdict Projection

SDK memory, capability, promotion, and concurrency verdict projection must align
to:

- `.nimi/spec/runtime/agent-participation.authority.yaml`

SDK must expose verdicts as typed Runtime decisions. SDK must not infer private
memory read access, canonical capability carryover, canonical memory write, or
cross-profile admission locally.

## S-RUNTIME-216 Audit and Replay Projection

SDK participation audit/replay projection must layer on existing Runtime audit
authority:

- `K-AUDIT-001` through `K-AUDIT-022`
- `K-AGCORE-087`
- `K-DELEG-085` and `K-DELEG-086` where delegated gateway evidence participates

SDK may expose typed audit and replay views, but it must preserve redaction,
access control, invalid-lineage failure states, and the absence of any
participation-specific side audit store.

## S-RUNTIME-217 Participation Method Registry

SDK participation method names, categories, source rules, and input/output
references are governed by
`.nimi/spec/sdks/feature-clients.authority.yaml`.

The table is the SDK method-family registry for implementation admission. It
does not by itself claim production availability. A method family becomes
public-production only when SDK implementation/generation, admitted transport,
and owner tests bind the registry entry. Missing implementation must fail
closed as unavailable and must not be advertised as active support.

## S-RUNTIME-218 Type Escape Prohibition

Participation SDK public types must use named interfaces, enums, tagged unions,
or schema-bound references. Stable SDK participation contracts must not use:

- `any`
- `Record<string, unknown>`
- free-form maps
- raw prompt blobs
- raw MCP/A2A payloads
- raw provider payloads
- raw memory payloads

Runtime-internal `systemPrompt` parameters are implementation details and do not
become SDK public API.

## S-RUNTIME-219 Consumer No-Bypass

SDK must not provide helper APIs that let Desktop, Web, Avatar, or apps
bypass Runtime participation authority with direct provider calls, direct model
selection, direct Realm GROUP AI write, raw prompt assembly, or direct
MCP/A2A client creation.

All participation execution must route through Runtime-owned authority and all
domain commits must remain under their domain owners.

## S-RUNTIME-220 Implementation And Consumer Availability Boundary

This contract admits the SDK typed contract and method registry only. SDK
implementation methods, generated client code, proto stubs, Desktop surfaces,
Avatar surfaces, app integrations, OASIS consumers, Scenario consumers,
A2A production entry, and MCP production entry are not implied by this
contract. Each surface requires its own admitted implementation and tests
before support is claimed.

Until those implementation gates exist, SDK must not claim production Runtime
Agent Participation support.

## Traceability

`S-RUNTIME-211` through `S-RUNTIME-220` define one SDK projection family for
Runtime Agent Participation. The family is intentionally typed-client-only:
SDK consumes `K-AGCORE-061` through `K-AGCORE-088` and existing Runtime audit /
delegation / Realm commit authority without re-owning them.

---

<!-- source: .nimi/spec/sdks/kernel/companion-participation-client-contract.md -->

# Companion Participation Client Contract

> Owner Domain: `S-RUNTIME-*`

This contract defines the SDK typed client boundary for companion participation
projection and bounded controls.

## S-RUNTIME-227 Typed Projection Only

The SDK must expose companion participation data as typed projection objects
matching Runtime-owned `CompanionParticipationProjection`. It must not expose
raw prompt blobs, provider payloads, raw APML/debug payloads, MCP/A2A payloads,
or domain state blobs as the primary companion surface API.

## S-RUNTIME-228 Control Surface Methods

Runtime SDK must expose companion participation through the typed module
`runtime.companionParticipation`. The module owns the SDK product API and must
provide:

- `getProjection`
- `request`
- `cancel`
- `openReplay`

Each control must route to Runtime-owned participation or replay RPC methods.
The SDK must not implement app-local execution, prompt assembly, provider/model
routing, memory write, cognition write, or domain commit.

SDK entrypoints must also export `decodeCompanionParticipationProjection` for
strict projection decoding and the generated companion participation enum
types. The generated protobuf shape is not the primary application API.

## S-RUNTIME-229 Fail-Closed Decoding

SDK decoders must fail closed on:

- unknown `surface_kind`
- unknown `trigger_source`
- unknown `status`
- missing `profile_ref` for execution requests
- missing `room_orchestration_ref` for domain contexts
- missing `candidate_ref` for `candidate_ready`
- missing `commit_ref` for `committed_by_owner`

## S-RUNTIME-230 Candidate Boundary

The SDK must preserve the distinction between Runtime candidate projection and
domain/canonical commit projection. It must not infer commit from candidate text
or app-side display state.

---

<!-- source: .nimi/spec/sdks/kernel/package-governance-contract.md -->

# SDKS Package Governance Contract

> Owner Domain: `S-PKG-*`

## S-PKG-001 TypeScript Package Metadata Ownership

`sdks/typescript/package.json`, `sdks/typescript/tsconfig.json`, and
`sdks/typescript/tsconfig.build.json` are the active TypeScript package
governance evidence. They must align with the single base-package layout,
public subpath contract, TypeScript build contract, and SDK release gates
defined by the sdks kernel.

## S-PKG-002 Root Documentation Boundary

SDK package support documents are package evidence, not independent semantic
authority. If they conflict with `.nimi/spec/sdks/**`, the sdks spec wins and
the support document must be corrected.

## S-PKG-003 Package Release Gate Alignment

SDK root package metadata must stay aligned with SDK testing and release gates. It must not introduce unpublished package names, ungoverned exports, hidden build entrypoints, or release behavior outside `S-GATE-*`, `S-SURFACE-*`, and `S-BOUNDARY-*` authority.

Simulator support uses the already public `@nimiplatform/sdk/testing` subpath;
it does not create a Simulator-specific SDK package, root export, transport, or
compatibility layer. Its implementation and package evidence must remain
reachable from the ordinary SDK build/test/coverage gates and from the
Simulator final-graph qualification gate.

## S-PKG-004 Audit Evidence Admission

Spec-first full audit may cover SDK root support files only through explicit evidence-root admission. Audit tools must not infer SDK root support ownership from package names or workspace membership alone.

## S-PKG-005 SDKS Family Metadata Boundary

`sdks/**` is the SDK-family workspace boundary governed by `S-SURFACE-019`.
Its support documents and package metadata are family evidence only after they
exist and are explicitly admitted by the sdks kernel.

`sdks/**` package metadata must not introduce public package names, release
commands, conformance commands, or export manifests before the corresponding
generator/conformance authority is admitted. No forwarding package or
compatibility shim may be created to bridge archived old SDK source and
`sdks/`.

---

<!-- source: .nimi/spec/sdks/kernel/typescript-vnext-contract.md -->

# TypeScript vNext Contract

Status: active product authority.

`sdks/typescript` is the next major implementation target for
`@nimiplatform/sdk`.

Public source-root targets:

- `core/contracts`
- `core/ai`
- `core/ai-runner`
- `core/testing`
- `features/conversation`
- `features/knowledge-context`
- `features/memory-context`
- `features/generation`
- `features/workflow`
- `features/evaluation`
- `features/toolkits`
- `adapters/vercel-ai`
- `adapters/openai-compatible`
- `adapters/mcp`
- `adapters/mastra`
- `adapters/langgraph`
- `adapters/llamaindex`
- `adapters/react`
- `adapters/next`
- `doctor`

Doctor boundary:

- `doctor` is the independent migration-assessment package
  (`@nimiplatform/sdk-doctor`), not a base SDK subpath and not an adapter.
- It performs read-only static analysis of an external app: it must not
  execute target code, reach the network, or mutate the scanned project.
- Its only framework-API-to-capability authority is
  `tables/framework-api-capability-map.yaml`; adapter capability truth stays
  in adapter manifests and `tables/typescript-adapter-capability-ledger.yaml`.
  The doctor must not carry private mappings or infer capabilities.
- A detected target-framework API absent from the map must be reported as
  `unknown-api`; it must never be silently skipped or counted as supported.
- Doctor output is a developer assessment projection only. It is not an
  admission evidence surface and creates no capability claim.

OpenAI-compatible boundary:

- Adapter v1 is a strict Chat Completions-compatible migration bridge only.
- Supported endpoint shape: `chat.completions.create`.
- Supported modes: non-streaming and streaming.
- Supported inputs: common chat generation parameters, function-tool
  definitions, `tool_choice`, `response_format`, and message roles
  `system`/`developer`/`user`/`assistant`/`tool`.
- Tool semantics: return OpenAI-style `tool_calls`; do not execute tools inside
  the adapter.
- Unsupported surfaces: `/v1/responses`, `/v1/completions`, `/v1/embeddings`,
  OpenAI built-in tools, file search, web search, code interpreter, stored chat
  completion CRUD, logprobs, `n > 1`, general OpenAI API compatibility, and
  Runtime REST bypass promises.
- Unsupported behavior: fail closed with `SDK_ADAPTER_FEATURE_UNSUPPORTED`.
