# Scheduling Contract

> Owner Domain: `K-SCHED-*`

## Scope

定义 runtime 调度器的 five-state preflight judgement 模型。本契约扩展 K-AIEXEC-004 声明的 semaphore baseline，增加非阻塞 peek、occupancy telemetry、typed denial 与 risk assessment 能力。

## K-SCHED-001 — Scheduling Judgement State Enum

调度判断状态固定为六值封闭枚举：

| State | Terminal | Meaning |
|-------|----------|---------|
| `runnable` | no | 有可用 slot，无资源冲突预测 |
| `queue_required` | no | 无可用 slot，需排队等待 |
| `preemption_risk` | no | 有可用 slot，但当前运行中任务可能被降级 |
| `slowdown_risk` | no | 资源紧张（VRAM / RAM / disk），执行可能变慢 |
| `denied` | yes | 硬约束阻止执行（如本地模型无 GPU、磁盘不足） |
| `unknown` | no | 调度器无法评估该维度（如缺少资源遥测） |

约束：

- `denied` 是唯一阻止进入 `Acquire` 的状态。其余五种状态均为 advisory，不阻止执行。
- `unknown` 只允许在调度器确实缺少评估信息时返回（如 Phase 1 缺少 VRAM 遥测）。不允许用 `unknown` 掩盖可评估但未实现的判断。
- 枚举值域扩展需修改本规则并通过 spec consistency check。

## K-SCHED-002 — Peek Contract

`Peek` 是非阻塞的 preflight 调度评估，不获取 slot。其 canonical evaluation model 固定为：

- **atomic unit**：单个 `SchedulingEvaluationTarget`
- **aggregate unit**：同一个 `appID` 下的一组 `SchedulingEvaluationTarget` 的 batch evaluation

### Atomic canonical input

```
SchedulingEvaluationTarget {
  capability: string
  mod_id?: string
  profile_id?: string
  resourceHint?: ResourceHint
}
```

约束：

- 一个 `SchedulingEvaluationTarget` 表示一个**具体可执行的 capability path**，不是 scope 全量配置。
- `mod_id` + `profile_id` 标识该 target 对应的 local profile identity；两者是 target-scoped，不是 batch-global。
- `resourceHint` 只允许描述该 target 的资源预估，不允许提升为 scope-global / batch-global 模糊字段。

### Batch input

- `appID: string` — 应用标识，与 `Acquire` 使用相同的 appID 语义
- `targets: []SchedulingEvaluationTarget` — 非空 target 集合。单 target 请求是 batch 的退化形态。

### Batch output

```
SchedulingBatchJudgement {
  aggregateJudgement: SchedulingJudgement
  occupancy: OccupancySnapshot
  targetJudgements?: []TargetSchedulingJudgement
}

TargetSchedulingJudgement {
  target: SchedulingEvaluationTarget
  judgement: SchedulingJudgement
}
```

语义：

- `aggregateJudgement` 是 scope / batch 级结论，不替代 target judgement 的语义来源。
- `targetJudgements`（如果返回）中的每一项对应一个 atomic target judgement。
- 单 target 请求时，`aggregateJudgement` 必须与该 target judgement 等值；不允许出现 aggregate 与 atomic 相互矛盾。

### Aggregate fold rule

aggregate state precedence 固定为：

1. `denied`
2. `queue_required`
3. `preemption_risk`
4. `slowdown_risk`
5. `unknown`
6. `runnable`

fold 规则：

- 对每个 target 独立计算一个 atomic `SchedulingJudgement`
- aggregate state 取 batch 内最高优先级 state
- `unknown` 永远不得被提升 / 投影为 `runnable`

`unknown` 参与规则固定为：

- 任一 target = `denied` -> aggregate = `denied`
- 否则任一 target = `queue_required` -> aggregate = `queue_required`
- 否则任一 target = `preemption_risk` -> aggregate = `preemption_risk`
- 否则任一 target = `slowdown_risk` -> aggregate = `slowdown_risk`
- 否则任一 target = `unknown` -> aggregate = `unknown`
- 否则 aggregate = `runnable`

### Aggregate detail / warning merge

aggregate `detail` 合并规则固定为：

1. 选出所有 `state == aggregate.state` 的 contributor targets
2. 按 `capability`、`mod_id`、`profile_id` 做稳定排序
3. 每个 contributor 渲染为 `<capability> (<mod_id>/<profile_id>): <detail>`
4. 用 `; ` 连接
5. 若 aggregate state 不是 `unknown` 且 batch 内存在 `unknown` target，则在末尾追加 `; unevaluated targets: <ordered target list>`

aggregate `resourceWarnings` 合并规则固定为：

- 对 batch 内全部 target 的 `resourceWarnings` 做稳定顺序 union
- 以 exact string 去重
- 不允许 synthesize 新 warning category

### Shared batch observation

- `Peek` 对一个 batch 请求必须只采样**一个** scheduler occupancy observation point。
- `SchedulingBatchJudgement.occupancy` 是该 batch 的 shared occupancy snapshot。
- 若 transport 同时在 `SchedulingJudgement.occupancy` 中嵌入 occupancy，则 `aggregateJudgement` 与所有 `targetJudgements` 中的 `occupancy` 必须与 shared batch occupancy **字节等值**；它们不是独立观测值。
- 若实现通过 repeated single-target peeks 内部拼装 batch 结果，只有当所有 atomic 结果的 occupancy 完全一致时才允许返回 aggregate 结果；否则必须 fail-close 到 `aggregateJudgement.state = unknown`，且不得伪造 merged occupancy。

### Proto direction

`proto/runtime/v1/ai.proto` 的 scheduling transport 方向固定为：

- request 采用 `repeated SchedulingEvaluationTarget targets`
- response 采用 shared batch occupancy + aggregate judgement
- response 可选返回 repeated per-target judgements 供 consumer 做精确映射 / 诊断

不允许长期保留“singular capability/mod_id/profile_id 请求”和“repeated targets 请求”并列作为双轨 canonical 形态。

Non-blocking guarantee：

- `Peek` 不得阻塞等待 slot。
- `Peek` 不得修改 scheduler 内部状态（不获取、不释放、不排队）。
- `Peek` 的结果是瞬时快照，不保证与后续 `Acquire` 结果一致。
- `Peek` 在 scheduler 不可用时必须返回 `state=unknown`，不得报错。

## K-SCHED-003 — Occupancy Telemetry

`Peek` 与 `Acquire` 结果必须包含 occupancy 快照：

```
OccupancySnapshot {
  globalUsed: int       // 当前已占用全局 slot 数
  globalCap: int        // 全局 slot 上限
  appUsed: int          // 当前 appID 已占用 slot 数
  appCap: int           // 每 app slot 上限
}
```

约束：

- occupancy 值必须在 slot acquire/release 时原子更新。
- occupancy 读取必须是 lock-free 或 short-critical-section，不得因 occupancy 查询阻塞执行路径。
- 实现可使用 atomic counters 或 channel length 查询，但必须保证与 slot 状态一致。
- 对 batch `Peek`，所有返回 judgement 引用的是同一个 shared occupancy snapshot；不存在 target-local occupancy timeline。

## K-SCHED-004 — Denied Hard Rules

`denied` 状态仅在以下条件成立时返回。multi-target 语义下，`denied` 首先是 **target-local** judgement，再按 K-SCHED-002 aggregate precedence 折叠到 batch 级结果。

| 条件 | 判断依据 | 状态 |
|------|---------|------|
| 本地模型需要 GPU 但设备无 GPU | `CollectDeviceProfile().gpu.available == false`（K-DEV-001） | 已实现 |
| 磁盘可用空间低于安全阈值 | `CollectDeviceProfile().disk_free_bytes < threshold`（K-CFG 配置路径驱动） | 已实现 |
| 必需依赖不满足 | `Peek` target 提供 `mod_id` + `profile_id` 标识目标 local profile。Runtime 从内部 profile registry 查找对应的 `LocalProfileDescriptor`，使用 `ResolveProfile` preflight decision 逻辑评估。当 required entry 的 preflight decision `ok=false` 时返回 `denied`。 | 已实现。target 未提供 `profile_id` 时此检查跳过。profile 在 registry 中未找到 / cannot evaluate 时跳过，不等于 infeasible。 |

约束：

- `denied` 必须附带 `detail` 说明具体原因。
- `denied` 不用于 transient failures（如网络超时）。transient failures 由 `Acquire` context cancellation 处理。
- `denied` 判断必须基于当前设备状态，不得缓存超过单次 `Peek` 调用。
- dependency denial 仅在对应 target 提供了 `profile_id` 且 runtime profile registry 中存在对应 profile 时触发。缺少 `profile_id` 或 profile 未注册时，该 target 跳过检查，不返回 `denied`。"无法评估" ≠ "infeasible"。
- Runtime profile registry 通过 `ResolveProfile` RPC 调用自动填充：每次 `ResolveProfile` 调用时，runtime 将请求中的 `LocalProfileDescriptor` 注册到 registry，供后续 `Peek` dependency denial 查找。
- 一个 target 的 dependency denial 不得“污染”其他 target 的 atomic judgement；aggregate `denied` 只来自 K-SCHED-002 的正式 fold，不允许以 batch-level side channel 直接构造 `denied`。
- 当 batch 内任一 target 为 `denied` 时，aggregate judgement 必须为 `denied`，即使其他 target 为 `runnable` 或 advisory state。

## K-SCHED-005 — Risk State Heuristic Boundary

### preemption_risk

`preemption_risk` 在以下条件成立时返回：

- 有可用 slot（不是 `queue_required`）
- 当前运行中任务的 aggregate resource demand + 新任务的 estimated demand 超过设备资源容量的 warning 阈值

Phase 1：runtime 缺少 per-execution resource footprint tracking，返回 `unknown`。
Phase 2：通过 `collectDeviceProfile()` 在 peek 时采集 VRAM/RAM，与运行中执行数做交叉评估。

### slowdown_risk

`slowdown_risk` 在以下条件成立时返回：

- 有可用 slot（不是 `queue_required`）
- 设备当前 available VRAM / RAM / disk 低于 per-capability 建议阈值

Phase 1：缺少 VRAM/RAM 实时遥测集成，返回 `unknown`。
Phase 2：消费 `CollectDeviceProfile()` 实时数据与 per-capability resource heuristic。

约束：

- risk state 阈值必须可配置（通过 K-CFG 配置路径）。
- risk state 不阻止执行；只作为 advisory warning 传递到 consumer。
- 不允许把 `unknown` 升级为 `runnable` 来掩盖评估缺失。

## K-SCHED-006 — Relationship To Acquire

- `Peek` 是 advisory preflight；`Acquire` 是 authoritative slot acquisition。
- `Peek` 返回 `runnable` 不保证后续 `Acquire` 不需等待（slot 可能在 peek 和 acquire 之间被占用）。
- `Peek` 返回 `queue_required` 不保证 `Acquire` 一定排队（slot 可能在 peek 和 acquire 之间被释放）。
- `Peek` 返回 `denied` 时 caller 不应调用 `Acquire`，但 scheduler 不强制（`Acquire` 仍然可调用，但大概率 context timeout 或 starvation）。
- execution path 中 `Peek` 是可选步骤。caller 可以直接 `Acquire` 而不先 `Peek`。
- `Peek` 的 `SchedulingJudgement` 可被捕获进 execution snapshot（K-AIEXEC-003），但不是 `Acquire` 的前置条件。

## K-SCHED-007 — Capability And Resource Hint Semantics

`Peek` 的 capability / profile identity / resource hint 语义固定为 **target-scoped repeated targets**，不再以 singular request fields 作为最终模型。

### Phase 1

- 每个 `SchedulingEvaluationTarget.capability` 被接受但可忽略。scheduler 仍可保持 capability-blind。
- 每个 `SchedulingEvaluationTarget.resourceHint` 被接受但可忽略。

### Phase 2+

- `capability` 用于对应 target 的 dependency feasibility 检查 filter（K-SCHED-004）。
- `resourceHint` 包含对应 target 的 estimated VRAM / RAM / disk consumption，用于 `slowdown_risk` 与 `preemption_risk` 评估。
- `mod_id` + `profile_id`：对应 target 的 profile identity reference，用于 dependency infeasible denial 判断。Runtime 从内部 profile registry 查找对应的 `LocalProfileDescriptor` 并使用 `ResolveProfile` preflight decision 逻辑评估。两者都提供时触发该 target 的 dependency denial 检查；缺少 `profile_id` 时仅跳过该 target 的此项检查。

`ResourceHint` 最小 schema：

```
ResourceHint {
  estimatedVramBytes?: int64
  estimatedRamBytes?: int64
  estimatedDiskBytes?: int64
  engine?: string
}
```

约束：

- resource heuristic 必须来自配置或设备画像推导，不允许 hardcode 固定值。
- `profile_id` 未提供时或 profile 在 registry 中未找到时，不得伪造 `denied`。"无法评估" 不等于 infeasible。
- `resourceHint` 只允许挂在 `SchedulingEvaluationTarget` 上；不允许引入 scope-global / batch-global `resourceHint` 作为模糊替代。
- `capability`、`mod_id`、`profile_id`、`resourceHint` 的 proto 方向应收敛到 `repeated SchedulingEvaluationTarget`。不允许继续把 singular request fields 视为最终 canonical shape。

## Fact Sources

- `scheduler.go` — current semaphore scheduler baseline
- `device-profile-contract.md` — K-DEV-001~007 (device profile collection)
- `ai-profile-execution-contract.md` — K-AIEXEC-003~004 (execution snapshot, scheduling boundary)
- `config-contract.md` — K-CFG-* (configuration paths)
- `local-category-capability.md` — K-LOCAL-013~015 (ResolveProfile, ApplyProfile)
