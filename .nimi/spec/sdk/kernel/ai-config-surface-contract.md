# SDK AI Config Surface Contract

> Owner Domain: `S-AICONF-*`

## Scope

定义 SDK 对 `AIProfile / AIConfig / AISnapshot` 的 typed surface，使 app consumer 无需直接操作底层 capability fragments 作为主真相。本契约依赖 desktop canonical model（D-AIPC-001~014）和 platform scope identity（P-AISC-001~005）。

## S-AICONF-001 — Typed Surface Categories

SDK AI config surface 固定分为以下 logical operation 类别：

### Profile catalog

- `aiProfile.list()` — 列出当前可用 profile catalog
- `aiProfile.get(profileId)` — 获取单个 profile 详情
- `aiProfile.validate(profile)` — static schema probe（D-AIPC-012 第一层）

### Profile apply

- `aiProfile.previewApply(scopeRef, profileId)` — 计算（不提交）将 profile 应用到 scope 时产生的 typed before→after `AIConfig` diff（D-AIPC-014）。详见 S-AICONF-008。
- `aiProfile.apply(scopeRef, profileId)` — 将 profile 原子覆盖到 scope 的 AIConfig（D-AIPC-005）
- apply 必须返回 typed result，包含 success / failure reason / probe warnings

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
  - `memoryEmbeddingConfig.get(scopeRef)` — 读取当前 user-editable config intent
  - `memoryEmbeddingConfig.update(scopeRef, patch)` — 更新 user-editable config
    intent
  - `memoryEmbeddingConfig.subscribe(scopeRef, callback)` — 订阅该 adjacent
    config 的 host-local 变化
- 该 family 只拥有 host-local editable config truth；不得返回或持久化 resolved
  embedding profile、bank bind result、migration state、或 cutover outcome

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

### Probe

- `aiConfig.probe(scopeRef)` — 对当前 AIConfig 执行 runtime availability probe（D-AIPC-012 第二层），消费 `runtime.route.checkHealth` / `runtime.route.describe`。返回 `AIConfigProbeResult`。
- `aiConfig.probeFeasibility(scopeRef)` — 对当前 AIConfig 执行 **scope aggregate** resource feasibility probe（D-AIPC-012 第三层）。消费 runtime `Peek`（K-SCHED-002）返回的 aggregate `SchedulingJudgement`，并在 `AIConfigProbeResult.schedulingJudgement` 中传递该 typed aggregate scheduling state。返回 `AIConfigProbeResult`。
- `aiConfig.probeSchedulingTarget(scopeRef, target)` — 对当前 submit-specific execution target 执行 target-scoped scheduling evaluation。`target` 语义对齐 K-SCHED-002 `SchedulingEvaluationTarget`。该调用消费 runtime `Peek`（K-SCHED-002）的 atomic target judgement，供 submit guard / execution snapshot evidence 使用。它不返回 scope aggregate judgement。

### Snapshot record / read

- `aiSnapshot.record(scopeRef, snapshot)` — 通过 Desktop host authority 记录当前 execution 的 canonical snapshot
- `aiSnapshot.get(executionId)` — 读取特定执行的 snapshot
- `aiSnapshot.getLatest(scopeRef)` — 读取 scope 最近一次执行 snapshot
- snapshot record / read 适用于 canonical app, module, and feature scopes；consumer 不得定义 consumer-local `AISnapshot` schema 或 local persistence 作为平行 owner。

## S-AICONF-002 — No Fallback Surface

SDK AI config surface 不暴露 fallback knob：

- 不允许 `apply({ fallback: 'allow' })` 式参数。
- apply 失败时必须返回 typed error，不允许静默降级到 partial config。
- probe 结果必须是 typed enum（`available` / `unavailable` / `degraded` / `unknown`），不允许 generic string reason。
- `probeFeasibility` 返回的 `AIConfigProbeResult.schedulingJudgement`（如果存在）必须是 typed `AISchedulingJudgement`，其 `state` 为 K-SCHED-001 封闭枚举。该值固定表示 scope aggregate judgement。`denied` 是 hard failure，不是 degraded success。`unknown` 只允许在 runtime 缺少评估信息时返回，且不得投影成 `runnable`。
- `probeSchedulingTarget(scopeRef, target)` 返回的 scheduling evidence 必须保持 typed `AISchedulingJudgement`，并严格对应该 target；不允许返回 scope aggregate judgement 作为近似值。
- `aiSnapshot.record(scopeRef, snapshot)` 必须显式传入 `scopeRef`，且 host 记录的 snapshot.scopeRef 必须与该 canonical scope 一致；不允许在 caller 省略 scope 时隐式回退到 chat scope。
- raw `runtime.route.*`、`runtime.scheduler.peek`、runtime local profile install/probe surface 只是不透明 low-level dependency；consumer 不得直接把这些 low-level API 作为 product-facing `AIConfig` / `AISnapshot` surface。

## S-AICONF-003 — AIScopeRef Consumption

SDK surface 的 scope parameter 统一使用 `AIScopeRef`（P-AISC-001）：

- SDK 不自行定义 scope identity schema。
- SDK 传入的 `AIScopeRef` 必须由 canonical factory 产出（P-AISC-002），SDK 不允许接受任意拼接的 scope key。
- SDK 不在 `AIScopeRef` 上附加 consumer-local fields（P-AISC-005）。
- AIConfig surface 调用必须显式传入 `scopeRef`；SDK 不得在 caller 省略 scope 时隐式回退到 `{ kind: 'app', ownerId: 'desktop', surfaceId: 'chat' }` 或其他 consumer-default scope。
## S-AICONF-004 — Runtime Local Profile Bridge

SDK 暴露 `AIProfile` -> runtime local profile 的 typed bridge：

- `aiProfile.resolveLocalDependencies(profileId, deviceProfile?)` — 将 portable profile 投影为 `LocalProfileDescriptor` 集合，可选传入 device profile 加速 feasibility 判断。
- 返回值必须明确区分 portable fields 与 runtime-local fields（D-AIPC-007）。
- SDK 不暴露 `LocalProfileDescriptor` 的裸构造器给 app；app 只能通过 `AIProfile` -> bridge 路径产出 local descriptor。

## S-AICONF-005 — Transport Boundary

SDK AI config surface 在 Phase 1 是 host-local surface（数据存储与 projection 在 desktop/web host 内），不是 daemon RPC projection：

- config read/write 操作走 desktop host persistence，不走 runtime daemon RPC。
- probe 操作消费 runtime daemon 的现有 route/health RPC（S-RUNTIME-074）。
- scheduling probe 操作消费 runtime daemon `Peek`（K-SCHED-002）。
- snapshot record / read 操作走 desktop host persistence。
- 本契约不在 runtime daemon 上新增 AIConfig CRUD RPC。
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

`MUST NOT`:

- SDK must not accept renderer/localStorage values, app-local caches,
  route-health probes, file paths, or caller-provided strings as sufficient
  first-run readiness evidence
- SDK must not expose a fallback chat scope or infer `desktop.chat.nimi` /
  `desktop.chat.agent` from an omitted scope

## S-AICONF-008 — Profile Apply Preview Surface

SDK 必须暴露 typed profile apply preview surface，使 app consumer 能在
commit 之前向用户展示 apply 的影响（D-AIPC-014）：

- `aiProfile.previewApply(scopeRef, profileId)` — 对给定 canonical `AIScopeRef`
  与 catalog profile 计算 typed before→after `AIConfig` diff，并返回该 diff 加上
  任何 probe / feasibility warning。
- 返回值是 typed preview result，至少包含：
  - `before: AIConfig | null` — preview 计算时该 scope 的当前 `AIConfig`；首次
    apply（scope 尚无 config）时为显式 `null`。
  - `after: AIConfig` — 按 `D-AIPC-005` overwrite 语义 full materialize 出的目标
    `AIConfig`（overwrite，不是 merge / partial patch）。
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
- `.nimi/spec/sdk/kernel/runtime-route-contract.md` — S-RUNTIME-074~078
- `.nimi/spec/sdk/kernel/surface-contract.md` — S-SURFACE-001~011
