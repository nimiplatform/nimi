# Agent 字段

Agent 概念的字段级参考：一个 Nimi Agent 在 Runtime、Realm、Avatar、Cognition 之间的字段形态。

## Agent 是什么

| 属性 | 说明 |
| --- | --- |
| 核心参与者 | 不是工具，不是会话，不是人设 |
| 持久身份 | 跨它造访的所有世界保持同一身份 |
| 权威 | 持有作用域能力 token；默认可向下委派一层 |
| 可组合性 | 行为来自四层独立演化的能力面 |

## 四层结构

| 层 | 承载 | 权威来源 |
| --- | --- | --- |
| Soul | 性格、价值观、底层倾向 | Agent 持久档案 |
| Brain | 推理、规划、决策 | Runtime Agent 执行 |
| Worldview | 对世界和其他 Agent 的认知模型 | Cognition 记忆 + Realm 只读视图 |
| Memory | 对事件、关系、习得的长期回忆 | Cognition 记忆服务 + Runtime 记忆库 |

四层共同决定 Agent 在某一时刻的行为。任何单层都不足以还原 Agent 全貌。

## Runtime 持有的 Agent 字段

| 字段 | 归属契约 | 规则前缀 |
| --- | --- | --- |
| Agent 生命周期（按 `agent_id`） | `runtime/kernel/runtime-agent-service-contract.md` | `K-AGCORE-*` |
| 会话连续性 | `runtime/kernel/agent-conversation-anchor-contract.md` | `K-AGCORE-*` |
| 持久呈现档案 | `runtime/kernel/agent-presentation-contract.md` | `K-AGCORE-*` |
| 瞬时呈现流 | `runtime/kernel/agent-presentation-stream-contract.md` | `K-AGCORE-*` |
| Hook 意图 | `runtime/kernel/agent-hook-intent-contract.md` | `K-AGCORE-*` |
| 输出线协议（APML） | `runtime/kernel/agent-output-wire-contract.md` | `K-AGCORE-*` |
| Avatar 调试改写 | `runtime/kernel/avatar-debug-projection-contract.md` | `K-AGCORE-*` |
| 非规范 Agent 接入 | `runtime/kernel/runtime-agent-participation-contract.md` | `K-AGCORE-*` |

## 会话锚（Conversation Anchor）

| 属性 | 值 |
| --- | --- |
| 作用域 | 单 Agent + 单会话 |
| 用途 | 让桌面端聊天 / Avatar / 网页端共享同一会话，不会退化成全局会话 |
| 归属 | Runtime |

## 呈现档案（Presentation Profile）

| 属性 | 说明 |
| --- | --- |
| Avatar backend | Live2D / VRM / 生成式动作 |
| 资产引用 | 与载体强相关的资产绑定 |
| 表情预设 | 默认表情行为 |
| 语音绑定 | 指向语音档案 |
| 持久性 | 缓变；跨重启与跨表面复用都保留 |

## Chat 轨与 Life 轨

每个 Agent 有两条独立执行轨。

| 轨 | 驱动方式 | 归属 |
| --- | --- | --- |
| Chat Track | 响应式：由用户或 App 输入触发 | Runtime |
| Life Track | 主动式：Agent 自主性 + Runtime hook 调度 | Runtime |

Life 暂停时，Chat 仍可用。Life 默认关闭，需显式启用。

| 字段 | 值 |
| --- | --- |
| Life 节奏 | `off` / `low` / `medium` / `high` |
| Life token 预算 | 默认按日 |
| 默认节奏 | `off` |

## Hook 意图（Hook Intent）

Agent 申请未来调度的强类型契约。模型不能直接发出自由格式的调度逻辑，只能产出强类型 `HookIntent`，由 Runtime 校验和准入。

| 属性 | 值 |
| --- | --- |
| 归属 | Runtime |
| 准入策略 | 窄准入；Runtime 强制类型契约 |
| 生命周期 | `pending` → `running` → `completed` / `failed` / `canceled` / `rescheduled` / `rejected` |

## APML 输出线协议

面向模型的 Agent 输出契约。

| 根标签 | 用途 |
| --- | --- |
| `<life-turn>` | Life 轨主动输出 |
| `<chat-track-sidecar>` | Chat 轨响应式 sidecar |
| `<canonical-review>` | 用于记忆准入的规范化复审输出 |

不准入 JSON 执行器兼容。APML 在产品代码接触前已解析为强类型 Runtime 事件。

## 记忆库作用域

| 作用域 | 可见性 | 归属 |
| --- | --- | --- |
| `AGENT_CORE` | Agent 私有 | Runtime |
| `AGENT_DYADIC` | 单一关系私有 | Runtime |
| `WORLD_SHARED` | 单一世界内可见 | Runtime + Realm 复制 |
| `APP_PRIVATE` | App 基础设施作用域 | Runtime infra |
| `WORKSPACE_PRIVATE` | 工作区基础设施作用域 | Runtime infra |

记忆是显式启用的。默认基底是 `Hindsight`（实验性）。出厂未准入任何记忆 provider。

## 记忆复制状态

| 状态 | 含义 |
| --- | --- |
| `pending` | 等待复制 |
| `synced` | 已复制到 Realm |
| `conflict` | 检出冲突；停止服务 |
| `invalidated` | Realm 治理判定缓存记忆失效；Runtime 不再供给 |

## Realm 持有的 Agent 字段

| 字段 | 归属契约 | 规则前缀 |
| --- | --- | --- |
| 公共 Agent 身份 | `realm/agent.md` | `R-*` |
| 跨世界社交位次 | `realm/social-contract.md` | `R-SOC-*` |
| 跨世界经济位次 | `realm/economy-contract.md` | `R-ECON-*` |
| 跨世界通行资格 | `realm/transit-contract.md` | `R-TRANSIT-*` |

## Avatar 持有的 Agent 字段

| 字段 | 归属契约 | 规则前缀 |
| --- | --- | --- |
| 形体改写 | `avatar/kernel/embodiment-projection-contract.md` | Avatar `*` |
| 载体视觉准入 | `avatar/kernel/carrier-visual-acceptance-contract.md` | Avatar `*` |
| 后端分支（Live2D / VRM 等） | `avatar/kernel/backend-branch-contract.md` | Avatar `*` |
| Agent 脚本 | `avatar/kernel/agent-script-contract.md` | Avatar `*` |
| Avatar 事件面 | `avatar/kernel/avatar-event-contract.md` | Avatar `*` |

## Cognition 持有的 Agent 字段

| 字段 | 归属契约 |
| --- | --- |
| 长期记忆 | `cognition/kernel/memory-service-contract.md` |
| 知识检索 | `cognition/kernel/knowledge-service-contract.md` |
| Prompt 模板 | `cognition/kernel/prompt-serving-contract.md` |
| 完成关卡 | `cognition/kernel/completion-contract.md` |

## 外部 Agent

| 字段 | 值 |
| --- | --- |
| 主体类型 | `ExternalPrincipal` |
| Token | 作用域受限、单次明文展示、不可变 token 账本 |
| 能力域 | `action.discover.*`、`action.dry-run.*`、`action.verify.*`、`action.commit.*` |
| 动作面 | Hook Action Fabric（Runtime + 桌面端 hook 能力沙盒） |

## 来源依据

- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/ai-last-mile.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-last-mile.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-output-wire-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml)
- [`.nimi/spec/realm/agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/agent.md)
- [`.nimi/spec/avatar/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/index.md)
- [`.nimi/spec/cognition/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/index.md)
