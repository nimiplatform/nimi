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
  embedding profile、bank bind result、migration state、或 cutover outcome。Durable
  binding intent authority belongs to Runtime memory per `K-MEM-006b`.

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
- adjacent live config（例如 memory embedding config）同样走 host-local
  persistence / subscription surface，不走 runtime daemon config CRUD RPC
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

- `.nimi/spec/desktop/kernel/ai-profile-config-contract.md` — D-AIPC-001~014
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — P-AISC-001~007
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` —
  P-AIPS-009 first-party app AIProfile hint, P-AIPS-013 Account Default Profile
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` —
  P-NAPP-002 registry row schema, P-NAPP-003 AIProfile selection hint
- `.nimi/spec/runtime/kernel/app-messaging-contract.md` — K-APP-017 app Open flow
- `.nimi/spec/runtime/kernel/ai-profile-execution-contract.md` — K-AIEXEC-001~007
- `.nimi/spec/runtime/kernel/runtime-memory-service-contract.md` — K-MEM-004~006b
- `.nimi/spec/runtime/kernel/scheduling-contract.md` — K-SCHED-001~007
- `.nimi/spec/sdks/kernel/runtime-route-contract.md` — S-RUNTIME-074~078
- `.nimi/spec/sdks/kernel/surface-contract.md` — S-SURFACE-001~011
