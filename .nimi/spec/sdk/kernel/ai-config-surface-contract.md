# SDK AI Config Surface Contract

> Owner Domain: `S-AICONF-*`

## Scope

定义 SDK 对 `AIProfile / AIConfig / AISnapshot` 的 typed surface，使 app / mod consumer 无需直接操作底层 capability fragments 作为主真相。本契约依赖 desktop canonical model（D-AIPC-001~012）和 platform scope identity（P-AISC-001~005）。

## S-AICONF-001 — Typed Surface Categories

SDK AI config surface 固定分为以下 logical operation 类别：

### Profile catalog

- `aiProfile.list()` — 列出当前可用 profile catalog
- `aiProfile.get(profileId)` — 获取单个 profile 详情
- `aiProfile.validate(profile)` — static schema probe（D-AIPC-012 第一层）

### Profile apply

- `aiProfile.apply(scopeRef, profileId)` — 将 profile 原子覆盖到 scope 的 AIConfig（D-AIPC-005）
- apply 必须返回 typed result，包含 success / failure reason / probe warnings

### Config read / write

- `aiConfig.get(scopeRef)` — 读取 scope 的当前 AIConfig
- `aiConfig.update(scopeRef, patch)` — 更新 scope 的 AIConfig（full materialized write，不允许 partial overlay）
- `aiConfig.listScopes()` — 列出已知 scope 集合
- 上述 config read / write 适用于 app / mod / module / feature scope；mod-facing consumer 不得以 ad hoc settings object、route override store、domain payload field 取代该 formal surface。

### Probe

- `aiConfig.probe(scopeRef)` — 对当前 AIConfig 执行 runtime availability probe（D-AIPC-012 第二层），消费 `runtime.route.checkHealth` / `runtime.route.describe`。返回 `AIConfigProbeResult`。
- `aiConfig.probeFeasibility(scopeRef)` — 对当前 AIConfig 执行 **scope aggregate** resource feasibility probe（D-AIPC-012 第三层）。消费 runtime `Peek`（K-SCHED-002）返回的 aggregate `SchedulingJudgement`，并在 `AIConfigProbeResult.schedulingJudgement` 中传递该 typed aggregate scheduling state。返回 `AIConfigProbeResult`。
- `aiConfig.probeSchedulingTarget(scopeRef, target)` — 对当前 submit-specific execution target 执行 target-scoped scheduling evaluation。`target` 语义对齐 K-SCHED-002 `SchedulingEvaluationTarget`。该调用消费 runtime `Peek`（K-SCHED-002）的 atomic target judgement，供 submit guard / execution snapshot evidence 使用。它不返回 scope aggregate judgement。

### Snapshot record / read

- `aiSnapshot.record(scopeRef, snapshot)` — 通过 Desktop host authority 记录当前 execution 的 canonical snapshot
- `aiSnapshot.get(executionId)` — 读取特定执行的 snapshot
- `aiSnapshot.getLatest(scopeRef)` — 读取 scope 最近一次执行 snapshot
- snapshot record / read 同时适用于 mod scope；mod consumer 不得定义 consumer-local `AISnapshot` schema 或 mod-local persistence 作为平行 owner。

## S-AICONF-002 — No Fallback Surface

SDK AI config surface 不暴露 fallback knob：

- 不允许 `apply({ fallback: 'allow' })` 式参数。
- apply 失败时必须返回 typed error，不允许静默降级到 partial config。
- probe 结果必须是 typed enum（`available` / `unavailable` / `degraded` / `unknown`），不允许 generic string reason。
- `probeFeasibility` 返回的 `AIConfigProbeResult.schedulingJudgement`（如果存在）必须是 typed `AISchedulingJudgement`，其 `state` 为 K-SCHED-001 封闭枚举。该值固定表示 scope aggregate judgement。`denied` 是 hard failure，不是 degraded success。`unknown` 只允许在 runtime 缺少评估信息时返回，且不得投影成 `runnable`。
- `probeSchedulingTarget(scopeRef, target)` 返回的 scheduling evidence 必须保持 typed `AISchedulingJudgement`，并严格对应该 target；不允许返回 scope aggregate judgement 作为近似值。
- `aiSnapshot.record(scopeRef, snapshot)` 必须显式传入 `scopeRef`，且 host 记录的 snapshot.scopeRef 必须与该 canonical scope 一致；不允许在 caller 省略 scope 时隐式回退到 chat scope。
- raw `runtime.route.*`、`runtime.scheduler.peek`、runtime local profile install/probe surface 只是不透明 low-level dependency；mod consumer 不得直接把这些 low-level API 作为 product-facing `AIConfig` / `AISnapshot` surface。

## S-AICONF-003 — AIScopeRef Consumption

SDK surface 的 scope parameter 统一使用 `AIScopeRef`（P-AISC-001）：

- SDK 不自行定义 scope identity schema。
- SDK 传入的 `AIScopeRef` 必须由 canonical factory 产出（P-AISC-002），SDK 不允许接受任意拼接的 scope key。
- SDK 不在 `AIScopeRef` 上附加 consumer-local fields（P-AISC-005）。
- AIConfig surface 调用必须显式传入 `scopeRef`；SDK 不得在 caller 省略 scope 时隐式回退到 `{ kind: 'app', ownerId: 'desktop', surfaceId: 'chat' }` 或其他 consumer-default scope。
- mod consumer 使用 AIConfig surface 时，应显式传入 canonical mod scope（Phase 1: `{ kind: 'mod', ownerId: <modManifestId>, surfaceId: 'workspace' }`），而不是依赖 app-level active scope 单值。

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
- 对 desktop mod consumer 而言，host-local surface 由 Desktop host 通过 mod host bridge 暴露；mod business code 不得自行持久化另一份 `AIConfig` truth 充当正式 owner。

## S-AICONF-006 — Subscription Surface

SDK 必须提供 AIConfig 变更订阅：

- `aiConfig.subscribe(scopeRef, callback)` — 当 scope 的 AIConfig 发生变更（apply / update）时通知 consumer。
- subscription 是 host-local event，不走 runtime daemon event stream。
- 用于驱动 `ConversationCapabilityProjection` 重算（D-LLM-017）。
- subscription 同样适用于 mod scope；mod consumer 不得把自己的 route-options polling 或 domain store watch 伪装成 `AIConfig` subscription owner。

## Fact Sources

- `.nimi/spec/desktop/kernel/ai-profile-config-contract.md` — D-AIPC-001~012
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — P-AISC-001~005
- `.nimi/spec/runtime/kernel/ai-profile-execution-contract.md` — K-AIEXEC-001~005
- `.nimi/spec/runtime/kernel/scheduling-contract.md` — K-SCHED-001~007
- `.nimi/spec/sdk/kernel/runtime-route-contract.md` — S-RUNTIME-074~078
- `.nimi/spec/sdk/kernel/surface-contract.md` — S-SURFACE-001~011
