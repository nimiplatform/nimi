# 实例生命周期

> 状态：运行中 (Running)。Avatar 应用的启动路径、实例注册表和有界移交语义已根据 `app-shell-contract.md` 和 `nimi-avatar.md` 发布。

一个 Avatar **实例**是一个正在运行的 Avatar 应用进程，它绑定到一个代理 (agent) 和（可选地）一个明确的 Avatar 实例 ID。实例生命周期涵盖了它如何启动、桌面如何移交启动上下文、多个实例如何协调以及哪些状态可以在多次启动之间持久存在。

## 实例的定义

| 概念 | 含义 |
| --- | --- |
| Avatar 实例 | 一个正在运行的 Avatar Tauri 进程 |
| 默认 Avatar 应用 ID | `nimi.avatar` |
| `agent_id` | 启动时必需；标识驱动此实例的代理 |
| `avatar_instance_id` | 启动时可选；标识一个特定的持久化实例 |
| `launch_source` | 可选，非权威性的启动来源追踪 |

Avatar 是一个经运行时准入的本地第一方应用。它可以像其他第一方应用一样使用运行时账户投影和运行时签发的短期访问令牌。它不持有刷新令牌、持久认证会话或独立的 Realm 认证事实。

## 启动意图

桌面通过一个最小的意图载荷启动 Avatar：

| 字段 | 必需？ | 备注 |
| --- | --- | --- |
| `agent_id` | 是 | 标识代理 |
| `avatar_instance_id` | 可选 | 针对特定实例进行重放 |
| `launch_source` | 可选 | 非权威性；仅用于追踪 |

桌面**不得**将范围绑定事实、视觉包事实、对话锚点事实、账户/用户事实或认证材料传递到默认的 Avatar 启动路径中。Avatar 通过运行时账户投影解析其所需信息。

显式仅绑定/嵌入式/委托式 Avatar 模式仍可根据 `K-BIND-*` 准入，但它不是默认的桌面启动路径。

## 实例注册表

`avatar_instance_registry` 是平台的投影，用于追踪活跃和持久化的 Avatar 实例。它是用于跨应用协调的衔接点。

| 使用者 | 提供内容 |
| --- | --- |
| 桌面聊天 | “此代理是否有活跃的 Avatar 实例？” |
| Avatar 伴随界面 | 健康指示器：此实例是否仍被准入？ |
| 订阅 Avatar 事件的其他应用 | 当存在多个实例时的跨实例关联 |

注册表投影是一个**投影**，而非远程控制界面。Avatar 实例的组合状态由运行时载体决定。注册表负责报告；它不发出命令。

## 组合状态机

Avatar 实例会经历由 Avatar 载体管理的组合状态：

```
loading → ready → degraded:* → relaunch-pending
```

| 状态 | 含义 |
| --- | --- |
| `loading` | 后端挂载、模型解析、界面组合初始化 |
| `ready` | 具象化阶段 + 伴随界面活跃；后端报告已准入的边界 |
| `degraded:*` | 特定的降级姿态（类型化原因代码）；降级界面取代具象化 + 伴随界面 |
| `relaunch-pending` | 实例计划重新启动（例如，后端需要重启） |

状态转换会发出 `avatar.composition.*` 事件。伴随界面不得自行决定就绪/降级状态——它消费（使用）投影。

## 跨界面连续性

同一个代理通常出现在：

- 桌面聊天（通过 `kit/features/avatar` 消费 `agent-avatar-surface-contract.md`）
- 独立的 Avatar 载体（此应用）

这些界面保持同步，因为它们都消费**相同的运行时投影**。它们彼此之间不进行协调；它们消费运行时事件流和注册表投影。

## 关闭时的有界移交

当 Avatar 关闭时（由用户或桌面发起），允许进行有界移交：

| 字段 | 允许移交 |
| --- | --- |
| `avatar_instance_id` | 是 |
| 界面归属 | 是 |
| `agent_id` | 是（重新断言） |
| 包描述符/路径 | 否 |
| 认证材料 | 否 |
| 锚点事实 | 否 |

持久化实例状态以 `avatar_instance_id` 为键，并在重用前会根据运行时快照重新验证。Avatar 不信任本地状态能在多次启动之间代表运行时权威。

## 读者场景：桌面为代理 X 启动 Avatar

1.  **桌面发出启动意图。** `{ agent_id: 'agent-x' }`。不包含包事实。不包含对话锚点。
2.  **Avatar 启动。** 通过运行时账户投影解析代理上下文。获取运行时签发的短期访问令牌。
3.  **后端挂载。** 一旦后端报告已准入的边界，组合状态从 `loading` 变为 `ready`。
4.  **注册表更新。** `avatar_instance_registry` 反映代理 X 的活跃实例。
5.  **桌面聊天界面更新。** 消费注册表；渲染“活跃实例”指示器，而无需直接与 Avatar 进程协调。

两个界面，一个事实来源。

## 读者场景：重放特定实例

1.  **桌面发出启动意图。** `{ agent_id: 'agent-x', avatar_instance_id: 'inst-7' }`。
2.  **Avatar 解析持久化状态。** 持久化状态以 `avatar_instance_id` 为键，并且在重用前**必须**通过运行时快照重新验证。
3.  **验证通过。** 后端挂载；恢复之前的边界。
4.  **组合达到 `ready` 状态。** 注册表更新。

如果快照验证失败，实例不会静默地以陈旧状态启动。失败是类型化的；实例要么全新启动，要么不启动。

## 读者场景：降级姿态

1.  **后端报告一个类型化的降级原因。** （例如，资产层级降级、音频桥接离线、生成运动提供者被阻塞）。
2.  **组合状态转换为 `degraded:<reason>`。**
3.  **降级界面激活。** 取代具象化 + 伴随界面。伴随界面不再活跃；根据契约，降级界面拥有整个视觉区域。
4.  **注册表更新。** 跨应用订阅者可以渲染降级指示器。
5.  **恢复。** 当后端恢复时，投影发出转换回 `ready` 状态的事件。

降级是一种类型化的姿态，而非回退机制。

## 实例生命周期不执行的操作

-   它不会静默地将 Avatar 提升为持久认证所有者。
-   它不允许桌面将包事实植入默认启动路径。
-   它不允许伴随界面覆盖组合状态。
-   它不会在多次启动之间持久化认证材料。
-   它不会在后端错误时静默重启——`relaunch-pending` 是一个明确的组合状态。

## 边界总结

| 关注点 | 所有者 |
| --- | --- |
| 启动意图结构 | 应用壳契约 (NAV-SHELL-*) |
| 组合状态机 | 应用壳契约 |
| 实例注册表投影 | 运行时 / Avatar 应用壳 |
| 持久化实例键控 | 应用壳契约 |
| 跨界面连续性 | 运行时账户投影 + 注册表 |
| 关闭时的有界移交 | 应用壳契约 |

## 来源依据

- [`.nimi/spec/avatar/kernel/app-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/app-shell-contract.md)
- [`.nimi/spec/avatar/nimi-avatar.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/nimi-avatar.md)
- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/runtime/kernel/avatar-debug-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/avatar-debug-projection-contract.md)
- [`.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md)