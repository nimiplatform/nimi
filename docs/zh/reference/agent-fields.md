# Agent 字段

Agent 概念的字段级参考：Nimi Agent 跨 Runtime、Realm、Avatar、Cognition 的形状。

## Agent 是什么

| 性质 | 描述 |
| --- | --- |
| 一等参与者 | **不是**工具、**不是** session、**不是** persona |
| 持久身份 | 跟 Agent 跨它访问的所有世界 |
| 权威 | 拥有 scoped 能力 token；默认能委派一级 |
| 可组合 | 行为来自四个独立演化的层 |

## 四层

| 层 | 装载 | 权威 |
| --- | --- | --- |
| Soul | 性格、价值、基础倾向 | Agent 持久 profile |
| Brain | 推理、规划、决策 | Runtime Agent 执行 |
| Worldview | 关于世界的信念、对其他 Agent 的模型 | Cognition 记忆 + Realm 读 |
| Memory | 长期事件、关系、学习的回忆 | Cognition 记忆服务 + Runtime 记忆 bank |

四层设计来组合。任意时刻的行为是四层的函数；Agent **不**可还原到任何单层。

## Runtime 拥有的 Agent 字段

| 字段 | 拥有者 | 规则前缀 |
| --- | --- | --- |
| Agent 生命周期（按 agent_id） | `runtime/kernel/runtime-agent-service-contract.md` | `K-AGCORE-*` |
| 对话连续性 | `runtime/kernel/agent-conversation-anchor-contract.md` | `K-AGCORE-*` |
| 持久呈现 profile | `runtime/kernel/agent-presentation-contract.md` | `K-AGCORE-*` |
| 瞬时呈现事件流 | `runtime/kernel/agent-presentation-stream-contract.md` | `K-AGCORE-*` |
| Hook intent | `runtime/kernel/agent-hook-intent-contract.md` | `K-AGCORE-*` |
| 输出线协议（APML） | `runtime/kernel/agent-output-wire-contract.md` | `K-AGCORE-*` |
| Avatar debug 读视图 | `runtime/kernel/avatar-debug-projection-contract.md` | `K-AGCORE-*` |
| 非规范化 Agent 参与 | `runtime/kernel/runtime-agent-participation-contract.md` | `K-AGCORE-*` |

## ConversationAnchor

| 性质 | 值 |
| --- | --- |
| 范围 | 每个 Agent + 每段对话 |
| 用途 | 让桌面端聊天 / Avatar / 网页端共享一段对话而**不**塌成全局 session |
| 拥有者 | Runtime |

## 呈现 profile

| 性质 | 描述 |
| --- | --- |
| Avatar 后端 | Live2D / VRM / 生成式动作 |
| 资产引用 | 载体特定资产绑定 |
| 表情预设 | 默认表情行为 |
| 语音绑定 | 声音 profile 引用 |
| 持久性 | 缓变；跨重启与跨面复用存活 |

## Chat Track / Life Track

每个 Agent 有两条独立执行轨。

| 轨 | 驱动 | 拥有者 |
| --- | --- | --- |
| Chat Track | 反应式 — 由用户/App 输入驱动 | Runtime |
| Life Track | 主动式 — 由 Agent 自主 + runtime hook 调度驱动 | Runtime |

Life 暂停时 Chat 仍可用。Life Track 是 opt-in、默认 off。

| 字段 | 值 |
| --- | --- |
| Life cadence | `off` / `low` / `medium` / `high` |
| Life token 预算 | 默认按日 |
| 默认 cadence | `off` |

## Hook Intent

Agent 用来请求未来调度动作的类型化合同。模型**不能**发自由调度逻辑；它们发 runtime 校验并准入的类型化 `HookIntent` 记录。

| 性质 | 值 |
| --- | --- |
| 拥有者 | Runtime |
| 准入 | 窄准入；runtime 强制类型化合同 |
| 生命周期 | `pending` → `running` → `completed` / `failed` / `canceled` / `rescheduled` / `rejected` |

## APML 输出线协议

模型面向的 Agent 输出合同。

| 根 tag | 用途 |
| --- | --- |
| `<life-turn>` | 主动 life-track 输出 |
| `<chat-track-sidecar>` | 反应式 chat-track 边路 |
| `<canonical-review>` | 记忆准入用的规范化 review |

JSON executor 兼容**未准入**。APML 在产品代码碰之前被解析、投到类型化 runtime 事件上。

## 记忆 bank 范围

| 范围 | 可见性 | 拥有者 |
| --- | --- | --- |
| `AGENT_CORE` | Agent 私有 | Runtime |
| `AGENT_DYADIC` | 按关系私有 | Runtime |
| `WORLD_SHARED` | 一个世界内可见 | Runtime + Realm 复制 |
| `APP_PRIVATE` | App 基础设施范围 | Runtime infra |
| `WORKSPACE_PRIVATE` | Workspace 基础设施范围 | Runtime infra |

记忆是 opt-in。默认基底 `Hindsight`（实验性）。**默认无**记忆 Provider 被准入。

## 记忆复制状态

| 状态 | 含义 |
| --- | --- |
| `pending` | 等待复制 |
| `synced` | 复制到 Realm |
| `conflict` | 检测到冲突；不能服务 |
| `invalidated` | Realm 治理失效缓存记忆；runtime 不能继续服务 |

## Realm 拥有的 Agent 字段

| 字段 | 拥有者 | 规则前缀 |
| --- | --- | --- |
| 公开 Agent 身份 | `realm/agent.md` | `R-*` |
| 跨世界社交身份 | `realm/social-contract.md` | `R-SOC-*` |
| 跨世界经济身份 | `realm/economy-contract.md` | `R-ECON-*` |
| 跨世界通行资格 | `realm/transit-contract.md` | `R-TRANSIT-*` |

## Avatar 拥有的 Agent 字段

| 字段 | 拥有者 | 规则前缀 |
| --- | --- | --- |
| 形体化呈现 | `avatar/kernel/embodiment-projection-contract.md` | Avatar `*` |
| 载体视觉接受度 | `avatar/kernel/carrier-visual-acceptance-contract.md` | Avatar `*` |
| 后端分支（Live2D / VRM / 等） | `avatar/kernel/backend-branch-contract.md` | Avatar `*` |
| Agent script | `avatar/kernel/agent-script-contract.md` | Avatar `*` |
| Avatar 事件面 | `avatar/kernel/avatar-event-contract.md` | Avatar `*` |

## Cognition 拥有的 Agent 字段

| 字段 | 拥有者 |
| --- | --- |
| 长期记忆 | `cognition/kernel/memory-service-contract.md` |
| 知识检索 | `cognition/kernel/knowledge-service-contract.md` |
| Prompt 模板 | `cognition/kernel/prompt-serving-contract.md` |
| Completion 闸门 | `cognition/kernel/completion-contract.md` |

## 外部 Agent

| 字段 | 值 |
| --- | --- |
| Principal 类型 | `ExternalPrincipal` |
| Token | Scoped、单次明文显示、不可变 token ledger |
| 能力域 | `action.discover.*`、`action.dry-run.*`、`action.verify.*`、`action.commit.*` |
| 动作面 | Hook Action Fabric（Runtime + 桌面端 hook 能力沙盒） |

## 来源

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
