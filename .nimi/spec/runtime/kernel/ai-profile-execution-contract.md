# AI Profile Execution Contract

> Owner Domain: `K-AIEXEC-*`

## Scope

定义 runtime 侧对 `AIProfile`（D-AIPC-002）的 probe、materialization、execution snapshot 与 resource scheduling 的 canonical rules。本契约桥接 desktop portable `AIProfile` 与现有 `ResolveProfile`/`ApplyProfile` 本地执行管道（K-LOCAL-013~015, K-LOCAL-014a）。

## K-AIEXEC-001 — AIProfile To Local Profile Projection

`AIProfile` 是 desktop-portable 配置包（D-AIPC-002），不直接等于 `LocalProfileDescriptor`（K-LOCAL-014a）。

projection 规则：

- `AIProfile` 中的每个 capability route intent，在目标设备上可能映射到零个或多个 `LocalProfileDescriptor` entries。
- 映射由 desktop/SDK 在 profile apply 时执行，产出一个或多个 `ResolveProfile` RPC 调用所需的 `LocalProfileDescriptor`。
- runtime 不负责理解 `AIProfile` portable schema；runtime 只接收并执行 `LocalProfileDescriptor`。
- desktop/SDK 负责 portable-to-local projection；runtime 负责 local execution truth。

边界固定为：

| 职责 | Owner |
| --- | --- |
| `AIProfile` portable schema 定义与验证 | Desktop Kernel (D-AIPC-002) |
| portable -> local profile descriptor projection | Desktop / SDK |
| `LocalProfileDescriptor` execution & install | Runtime (K-LOCAL-013~015) |
| device profile collection | Runtime (K-DEV-001~009) |
| local asset resolution & health | Runtime (K-LOCAL-014a) |

## K-AIEXEC-002 — Probe Contract

Runtime 对 `AIProfile` 相关 probe 请求的响应分为三层，对应 D-AIPC-012 probe taxonomy：

### Static schema probe

- 由 desktop/SDK 在本地执行，不需要 runtime RPC。
- 验证 `AIProfile` portable schema 合法性。
- runtime 不参与此层 probe。

### Runtime availability probe

- 消费 `runtime.route.checkHealth(...)` 与 `runtime.route.describe(...)` 的现有 RPC。
- 检查所需 provider / engine / route 是否在线可用。
- runtime 不新增专用 probe RPC；availability probe 复用现有 route health surface。

### Resource feasibility probe

- 消费 `CollectDeviceProfile`（K-DEV-001）获取当前设备资源状态。
- 消费 `ResolveProfile`（K-LOCAL-014a）获取执行计划与 warnings。
- 消费 runtime scheduler `Peek`（K-SCHED-002）获取动态并发 / scheduling judgement。
- `ResolveProfile` 负责 local dependency / execution plan feasibility；`Peek` 负责 scheduling preflight。两者不可互相替代。
- 当 caller 需要 scope-level feasibility 时，消费 K-SCHED-002 的 aggregate judgement；当 caller 需要 submit-specific execution truth 时，消费对应 target judgement。

## K-AIEXEC-003 — Execution Snapshot Contract

runtime 侧执行快照的最小要求：

- 每次 `ExecuteScenario` / `StreamScenario` / `SubmitScenarioJob` 调用时，runtime 必须在 execution context 中固化以下 evidence：
  - 调用方提供的 route binding evidence（provider / model / connector / endpoint）
  - resolved effective capability（runtime 侧 resolve 结果）
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
- 对 desktop mod consumer，app-facing `AISnapshot` 的 record / read owner 仍是 Desktop host；mod host bridge 负责把 mod execution 绑定到 canonical mod `scopeRef` 并记录 snapshot。
- runtime 不感知 mod business code 的 consumer-local snapshot model；runtime 只提供 execution evidence 数据，不能被解释为把 snapshot ownership 下放给 mod。
- runtime 不感知 desktop 的 `AISnapshot` 或 `AIConfig` schema；runtime 只提供 execution evidence 数据。

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

## K-AIEXEC-006 — Memory Embedding Binding Resolution Boundary

memory embedding 的 editable binding intent 可以由 Desktop host 持有，但 runtime
负责把该 intent 解析为真正的 execution/bank truth。

固定规则：

- runtime 必须把 host 提供的 memory embedding binding intent 解析成
  runtime-owned resolved embedding profile 或 fail-close result
- `cloud` binding 的 legality 继续消费 connector / key-source authority：
  admitted shape 至少为 `connector_id + model_id`
- `local` binding 的 legality 继续消费 runtime local/model authority：
  admitted shape 必须是可由 runtime authoritative local inventory 解析的 typed
  local embedding target reference
- Desktop/SDK 不得自行计算 resolved embedding profile、profile identity、或
  canonical bank binding truth；它们只能持有 user intent 与 runtime projection
- 若 binding intent 不能解析到 admitted embedding-capable execution path，
  runtime 必须返回 fail-close result，不得静默回退到别的 connector、provider、
  或本地默认 embedding target

## Fact Sources

- `local-category-capability.md` — K-LOCAL-013~015, K-LOCAL-014a (`ResolveProfile`, `ApplyProfile`)
- `device-profile-contract.md` — K-DEV-001~009 (device profile collection)
- `model-service-contract.md` — K-MODEL-001~008 (model descriptor, health check)
- `scheduling-contract.md` — K-SCHED-001~007 (five-state scheduling judgement)
- `key-source-routing.md` — K-KEYSRC-001~011 (remote binding legality)
- `connector-contract.md` — K-CONN-001~017 (connector custody and legality)
- `.nimi/spec/desktop/kernel/ai-profile-config-contract.md` — D-AIPC-001~012 (desktop AI config authority)
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — P-AISC-001~005 (AIScopeRef)
