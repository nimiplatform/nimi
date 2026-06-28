# AI 配置文件执行

## 状态：已准入契约；公开调用以 Runtime/Desktop 暴露面为准

`AIProfile` 执行的运行时合约 (`K-AIEXEC-001..K-AIEXEC-005`) 已在内核级别被准入。从桌面可移植 `AIProfile` 到本地配置描述符的映射作为规范边界提供；探针 + 快照 UI 由暴露它们的 Runtime/Desktop surface 拥有。

## 本页涵盖的内容

`AIProfile` 是 **桌面可移植的 AI 配置包**（见 `D-AIPC-002`）。它并不直接等同于 `LocalProfileDescriptor` (`K-LOCAL-014a`)。本页涵盖了运行时如何执行本地端映射——探针、快照、解析以及 `AIScopeRef` 链接。

## 权责边界

| 职责 | 负责人 |
| --- | --- |
| `AIProfile` 可移植模式定义 + 验证 | 桌面内核 (`D-AIPC-002`) |
| 可移植 → 本地描述符映射 | 范围所有者 / SDK |
| `LocalProfileDescriptor` 执行 + 安装 | 运行时 (`K-LOCAL-013..015`) |
| 设备配置文件收集 | 运行时 (`K-DEV-001..009`) |
| 本地资源解析 + 健康状况 | 运行时 (`K-LOCAL-014a`) |
| 执行快照证据 | 运行时 (`K-AIEXEC-003`) |

运行时 **不是** 可移植模式验证器。它接受并执行 `LocalProfileDescriptor`；范围所有者 / SDK 的映射将可移植的 `AIProfile` 转换为描述符。

## 探针合约

探针分为三个层级（与 `D-AIPC-012` 匹配）：

| 层级 | 执行位置 | 回答的问题 |
| --- | --- | --- |
| 静态模式探针 | 范围所有者 / SDK 本地 | `AIProfile` 可移植模式是否有效？ |
| 运行时可用性探针 | 运行时通过 `runtime.route.checkHealth` / `runtime.route.describe` | 路由的提供者 / 引擎是否可用？ |
| 资源可行性探针 | 运行时通过 `CollectDeviceProfile` + `ResolveProfile` + `Peek` | 该设备能否运行此配置文件？ |

静态模式验证不需要运行时 RPC。运行时不参与该循环。运行时可用性探针重用现有的路由健康表面；运行时不引入专用的探针 RPC。资源可行性探针使用现有的调度器和解析器表面；`ResolveProfile` 和 `Peek` 不可互换。

## 执行快照合约

对于每个 `ExecuteScenario` / `StreamScenario` / `SubmitScenarioJob`，运行时必须在执行上下文中固定以下证据：

| 证据 | 来源 |
| --- | --- |
| 调用者提供的路由绑定证据 | 提供者 / 模型 / 连接器 / 端点 |
| 解析的有效能力 | 运行时解析结果 |
| 设备资源快照 | 调度器占用情况 + 可选的设备配置文件摘要 |
| 调度预检判断 | 可选；来自 `Peek` (`K-SCHED-002`) 在 `Acquire` 之前 |

一旦写入，证据不能被后续的配置更改覆盖。它会写入审计跟踪 (`K-AUDIT-001`)。

写入快照的 `schedulingJudgement` 必须对应于 **提交特定的** 能力 / 目标。它 **不是** 范围级别的聚合探针结果的替代品。如果调用者只有范围聚合判断而没有提交目标判断，则快照的 `schedulingJudgement` 必须为 `null` —— 运行时不会将范围聚合提升为提交证据。

## 与桌面 `AISnapshot` 的关系

| 表面 | 角色 |
| --- | --- |
| 桌面 `AISnapshot.runtimeEvidence` | 使用运行时执行证据 |
| 桌面 `ConversationExecutionSnapshot` (`D-LLM-019`) | 记录面向应用的执行证据 |
| `AISnapshot.runtimeEvidence.schedulingJudgement` (`D-AIPC-004`) | 仅提交特定的执行目标判断 |

运行时无法感知桌面的 `AISnapshot` 或 `AIConfig` 模式。它提供执行证据数据；这些数据不会将快照所有权转移给运行时。

对于应用消费者，面向应用的 `AISnapshot` 记录 / 读取所有者仍然是范围所有者。SDK 将执行绑定到规范的应用 `scopeRef`（参见 [AI 范围身份](/platform/ai-scope-identity)），并记录快照投影。运行时无法感知消费者本地的快照模型。

## 读者场景：应用工作区在 AI 配置文件下执行

1. **配置文件应用。** 范围所有者将可移植的 `AIProfile` 转换为此设备的 `LocalProfileDescriptor`。
2. **范围身份。** 应用工作区的 `AIScopeRef{ kind: 'app', ownerId: <app id>, surfaceId: 'workspace' }` 键控快照。
3. **执行调用。** `SubmitScenarioJob`（或等效操作）通过解析后的描述符进行。
4. **执行快照。** 运行时在执行上下文中固定四个证据行。
5. **审计跟踪。** 证据通过 `K-AUDIT-001` 写入。
6. **应用 `AISnapshot.runtimeEvidence`。** 范围所有者将其读入面向应用的快照模型。

## 读者场景：资源可行性探针

1. **调用者发起探针。** 想知道当前负载下该设备是否可以运行此配置文件。
2. **设备配置文件。** 运行时调用 `CollectDeviceProfile`。
3. **计划 + 警告。** 运行时调用 `ResolveProfile` 获取执行计划 + 警告。
4. **调度预检。** 运行时调用调度器 `Peek` 获取动态并发 / 调度判断。
5. **聚合判断。** 调用者收到其实际打算提交的目标的可行性；聚合判断不会提升为提交真相。

## 读者场景：范围 vs 提交判断

调用者有一个范围聚合判断（例如，“此配置文件在此设备上当前调度器负载下是广泛可行的”），但没有提交特定的判断。

1. **调用者提交。** 没有进行提交特定的 `Peek` 调用。
2. **快照写入。** 运行时设置 `executionSnapshot.schedulingJudgement = null`。
3. **无提升。** 范围聚合不会在快照中默默地提升为提交目标判断。
4. **审计反映真相。** 审查者看到“此提交未记录提交特定的判断。”

该合约严格是因为范围与提交混淆会隐藏调度预检实际运行的时间。

## AI 配置文件执行不做的事情

- 它不验证 `AIProfile` 可移植模式（桌面负责）。
- 它不为运行时可用性引入新的探针 RPC（重用现有健康表面）。
- 它不允许范围聚合判断替代执行快照中的提交判断。
- 它不拥有桌面或模块快照模式。
- 它不会在后续配置更改后默默地覆盖执行证据。

## 边界总结

| 关注点 | 负责人 |
| --- | --- |
| `AIProfile` 可移植模式 | 桌面内核 (`D-AIPC-002`) |
| 可移植 → 本地映射 | 桌面 / SDK |
| `LocalProfileDescriptor` 执行 | 运行时 (`K-LOCAL-013..015`) |
| 探针层级 | 混合（静态 = 桌面；可用性 = 运行时路由健康；可行性 = 运行时设备 + 解析器 + 调度器） |
| 执行快照证据 | 运行时 (`K-AIEXEC-003`) |
| `AIScopeRef` 身份 | 平台 (`P-AISC-*`) |

## 来源依据

- [`.nimi/spec/runtime/kernel/ai-profile-execution-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/ai-profile-execution-contract.md)
- [`.nimi/spec/platform/kernel/ai-scope-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-scope-contract.md)
