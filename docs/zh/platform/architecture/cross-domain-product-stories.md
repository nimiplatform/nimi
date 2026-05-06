# 跨域产品故事

架构页给的是拓扑。本页给的是走读。下面每个故事都跟踪一次真实的产品流程跨多个权威域，展示各层实际怎么互动。

字段级定义见 [Reference → World Fields](/zh/reference/world-fields)、[Reference → Agent Fields](/zh/reference/agent-fields) 和 [Reference → State Machines](/zh/reference/state-machines)。

## 故事 1：一次流式生成请求

你是一个 App，要让平台在某个世界上下文里生成一段流式多模态回应。

1. **App → SDK**。App 调 `sdk/runtime`。传一个类型化请求，描述模态、上下文、目的地。**不** import 私有 runtime 模块。
2. **SDK → Runtime**。SDK 通过当前 transport profile 把调用送到 Runtime（桌面端是 `tauri-ipc`，Node 是 `node-grpc` 等）。
3. **Runtime 工作流生命周期**。请求变成一个工作流，状态走 `ACCEPTED → QUEUED → RUNNING`。如果涉及下游 Provider，Provider 异步任务走 `queued → running → succeeded | failed | expired`，规范化进工作流状态机。
4. **流式语义**。流式 chunk 在四种流式模式之一（A/B/C/D）下到达 SDK。阶段边界、终止帧、错误语义都是类型化合同；违反合同的 chunk fail-closed。
5. **多模态产物投递**。如果回应包含图像 / 音频 / 视频 / 声音 / 音乐产物，产物走多模态产物合同 — 类型化的规范字段、来自合同的 MIME 类型，**不**在 App 层猜测。
6. **审计 lineage**。Runtime 本地审计 ledger 记录工作流，包括 Provider 路由、ScenarioJob 生命周期、（如有）委派 lineage、终态。

如果第 4 或第 5 步违反合同 — 错误的 MIME、缺少必填字段、未知的 chunk 形状 — runtime 发出有类型的终止失败帧，工作流走到 `FAILED`。App **不会**无声地看到「best-effort」式的成功。

## 故事 2：一次跨世界移动

一个叫 Mira 的 Agent 住在 World A，在那经营花店。一个用户邀请她访问 World B，一个音乐演出。

1. **身份保留**。Mira 的身份是规范 Realm 真相 — 一个身份被她访问过的每个世界使用。World B **不**创建一个新的 Mira；它接纳已有的那个。
2. **走 OASIS 跨世界**。创作者世界**不能**直接对等跨越。World A → OASIS → World B。跨越是一个保留身份、不修改世界真相的单跳连续协议。
3. **社交状态选择性跨越**。平台 Social 基础协议描述关系如何在跨世界含义里被表达。Mira 在 World A 的友谊**不**自动复制；跨过去的部分走 Social 合同。
4. **经济是规范的**。Mira 的钱包和经济地位是平台真相。她在 World A 赚的货币在 World B 内部经济里可能有不同本地含义，但规范余额和事件历史**不**按世界发明。
5. **记忆随身份保留**。Mira 的 `AGENT_CORE` 记忆库是她的，复制到 Realm。她在 World B 时记得 World A 的事。Cognition 和 Runtime 在这件事上协作；桥合同决定 Cognition 把什么暴露给 Runtime。
6. **呈现适应**。Avatar 的具身呈现可能在 World B 的承载面上以不同方式表现 Mira。Avatar **不**重新定义 Mira — Mira 的身份留着，只有呈现的方式变了。

这一个例子触及 Platform（Transit、Social、Economy）、Realm（真相、Transit、社交、经济）、Runtime（记忆库复制）、Cognition（记忆权威）、Avatar（呈现）。这些层都不被允许无声地重新定义另一方的真相；架构存在的目的，正是让这个故事在没有权威漂移的前提下成立。

## 故事 3：委派 AI 执行一次动作

你把一个外部 AI 宿主（独立 AI Provider）作为 `ExternalPrincipal` 准入。你想让它代表你给朋友送一份礼物。

1. **外部 AI 注册**。桌面端的 External Agent Access 面板签发一个 scoped token，带 `action.discover.*`、`action.dry-run.*`、`action.verify.*`、`action.commit.*` 能力域。token 单次明文显示；之后只能从 immutable token ledger 看。
2. **委派会话开启**。Runtime 给外部 principal 开一个委派会话。会话有信任层级（`CONTROLLED_LOCAL` / `USER_ADDED_REVIEWED` / `ORG_MANAGED` / `BLOCKED`）和策略快照。
3. **外部 AI 提议**。外部 AI 发一个类型化委派请求 — 比如 `SUGGEST_INTENT`，附带它想做的动作（给朋友送礼）。
4. **输出防火墙分类**。防火墙校验 schema、来源、descriptor hash、敏感度，检测 prompt poisoning，推断批准要求，发出之一：`ACCEPTED_OBSERVATION`、`ACCEPTED_SUGGESTION`、`APPROVAL_REQUIRED`、`QUARANTINED`、`REJECTED`、`PROVIDER_DRIFTED`、`SCHEMA_INVALID`、`POLICY_BLOCKED`。
5. **必要时批准**。如果是 `APPROVAL_REQUIRED`，你在桌面端 UI 批准。批准被记成证据。
6. **Runtime 执行**。Runtime 在自己的审计 lineage 下执行动作 — **不**是外部 AI 的 lineage。礼物通过 Realm 提交。外部 AI 没有直接改 Realm；Runtime 代表用户做的。
7. **审计 lineage**。委派审计把建议链到防火墙裁决、链到批准、链到 realm 提交。每一步都可以重建。

架构承诺：被建议的工具调用**永远不**直接执行。Runtime 永远重新授权，发出由 Runtime 拥有的、带独立审计 lineage 的动作。

## 故事 4：Agent 跨会话记得用户

用户周一跟一个 Agent 聊。周三回来。Agent 应该记得。

1. **记忆写入**。周一对话时，Agent 在 Cognition 记忆服务下把一个记忆（"用户提到 3 月 12 日生日"）写到 `AGENT_CORE` 库。
2. **复制**。Runtime 把记忆复制到 Realm，复制状态走 `pending → synced`。
3. **新会话开始**。周三，用户打开聊天。Runtime 通过 Realm 解析用户身份；Agent 的身份是持久的。
4. **Cognition 桥**。Runtime 通过桥合同调 Cognition 解析新对话相关的记忆。Cognition 在桥合同下返回记忆；Runtime 消费它而不重新定义记忆是什么。
5. **对话锚**。对话有自己的 `ConversationAnchor` — per-Agent + per-conversation。如果用户晚一点在 Avatar 或网页端继续这段对话，锚让面板共享对话而不塌成全局会话。
6. **APML 输出**。Agent 的 life-track 和 chat-track turn 输出走 APML 线格式，被 Runtime 解析成有类型的事件之后才被产品代码看到。
7. **呈现反映状态**。Avatar 的具身呈现反映 Agent 当下的情绪 / 姿态 / 注意力，从 runtime 的呈现流中读取。

这就是"Agent 跨会话还是同一个生命体"在架构上的样子。它不是一段单独的代码；它是 Runtime、Cognition、Realm、Avatar 各守其位的协奏。

## 这些故事的共性

| 性质 | 含义 |
| --- | --- |
| 多域 | 每个故事触及三个或更多权威域 |
| 尊重所有权 | 没有任何一个域被允许重新定义另一方的真相 |
| 边界中介 | 每次跨域互动都走一条已认可合同 |
| 可审计 | 每一步都被记录；用户 / 审计 / 未来实现者能重建发生过什么 |

架构存在的目的，是让这些故事在没有无声捷径的前提下成立。当某件事感觉意外（云断了 AI 还能用、外部 AI 不能直接按按钮），那是架构在做它被设计来做的事。

## 来源

- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/multimodal-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/multimodal-provider-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md)
- [`.nimi/spec/realm/transit.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/transit.md)
- [`.nimi/spec/realm/agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/agent.md)
- [`.nimi/spec/realm/social.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/social.md)
- [`.nimi/spec/realm/economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/economy.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
