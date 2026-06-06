# 跨域产品故事

架构页给的是拓扑，本页给的是走读。下面每个故事都跟踪一次真实的产品流程跨多个权威域，展示各层实际怎么互动。

字段层定义见[参考 → 世界字段](/zh/reference/world-fields)、[参考 → Agent 字段](/zh/reference/agent-fields)、[参考 → 状态机](/zh/reference/state-machines)。

## 故事 1：一次流式生成请求

你在做一款应用，想让平台在某个世界的上下文里生成一份流式多模态响应。

1. **应用 → SDK**。应用调用 `@nimiplatform/sdk/runtime`，传入一份强类型请求（模态、上下文、目的地），不 import 私有 Runtime 模块。
2. **SDK → Runtime**。SDK 通过当前传输画像（桌面端的 `tauri-ipc`、Node 上的 `node-grpc` 等）把调用送到 Runtime。
3. **Runtime 工作流生命周期**。请求变成一个工作流。工作流走 `ACCEPTED → QUEUED → RUNNING`。如果涉及下游 Provider，Provider 异步任务走 `queued → running → succeeded | failed | expired`，归一化进工作流状态机。
4. **流式语义**。流式分片按四种模式（A/B/C/D）之一到达 SDK。阶段边界、结尾帧、错误语义都是强类型契约；违反契约的分片失败拒绝。
5. **多模态产物投递**。如果响应包含图像 / 音频 / 视频 / 语音 / 音乐，产物按多模态产物契约下发——强类型规范字段、契约定义的 MIME 类型，应用层不靠猜测。
6. **审计血缘**。Runtime 本地审计账本记录这次工作流，含 Provider 路由、场景任务生命周期、（如有）委派血缘、终态。

任何第 4 或第 5 步违反契约——MIME 不对、缺必需字段、未知分片形态——Runtime 发出强类型终态失败帧，工作流转 `FAILED`。应用不会静默看到"尽力而为"的成功。

## 故事 2：一次跨世界穿越

一个名叫 Mira 的 Agent 住在世界 A，开着小花店。某用户邀请她去世界 B 听音乐会。

1. **身份不变**。Mira 的身份是 Realm 规范态——每个世界都用同一个身份。世界 B 不会创建新的 Mira，只准入已有的那个。
2. **走 OASIS 穿越**。创作者世界之间不能直接对等穿越。世界 A → OASIS → 世界 B。穿越是一段单跳连续协议，保留身份不修改世界真相。
3. **社交状态选择性跨过**。平台社交基础协议描述跨世界含义如何表达。Mira 在世界 A 的好友关系不会自动复制；什么跨过、怎么跨过，都按社交契约。
4. **经济规范化**。Mira 的钱包与经济地位是平台真相。她在世界 A 赚的货币在世界 B 的内部经济里可能有不同含义，但规范化余额与事件历史不按世界发明。
5. **记忆同行**。Mira 的 `AGENT_CORE` 记忆库是她的，复制到 Realm。她在世界 B 仍记得世界 A 的事。Cognition 与 Runtime 协作；桥接契约规定 Cognition 把什么暴露给 Runtime。
6. **呈现适配**。Avatar 的具身化呈现可能为世界 B 的承载面以不同形态表达 Mira。Avatar 不重新定义 Mira——身份不变，只是呈现层在变。

这一例触及平台（Transit、Social、Economy）、Realm（truth、transit、social、economy）、Runtime（记忆库复制）、Cognition（记忆权威）、Avatar（呈现）。各层不允许静默重定义对方的真相；架构存在的意义就是让这种故事成立而不出现权威漂移。

## 故事 3：未来受委派的 AI 行动

在 Runtime-owned External Agent action plane 准入之后，你把一个外部 AI 宿主（独立 AI Provider）准入为 `ExternalPrincipal`。你想让它代你给一个朋友送一份礼物。

1. **Runtime 准入外部 principal**。Runtime 持有 gateway、token ledger 与 action registry。桌面端只投影用户控件。
2. **委派会话开**。Runtime 给外部 principal 打开委派会话。会话有信任层级（`CONTROLLED_LOCAL` / `USER_ADDED_REVIEWED` / `ORG_MANAGED` / `BLOCKED`）与策略快照。
3. **外部 AI 提议**。它发出强类型委派请求——比如 `SUGGEST_INTENT`（动作：给朋友送礼物）。
4. **输出防火墙分类**。校验 schema、来源、描述符哈希、敏感度；识别 prompt 投毒；推导审批要求；吐出裁决：`ACCEPTED_OBSERVATION`、`ACCEPTED_SUGGESTION`、`APPROVAL_REQUIRED`、`QUARANTINED`、`REJECTED`、`PROVIDER_DRIFTED`、`SCHEMA_INVALID`、`POLICY_BLOCKED`。
5. **如需审批则审批**。`APPROVAL_REQUIRED` 时，你在桌面端 UI 同意。同意被记为证据。
6. **Runtime 行动**。Runtime 在自己的审计血缘下行动——不是外部 AI 的。礼物经 Realm 提交。外部 AI 没有直接修改 Realm；Runtime 代用户做了。
7. **审计血缘**。委派审计把建议、防火墙裁决、审批、Realm 提交串起来。每一步都可重建。

架构承诺：外部建议的工具调用**永远不会**直接执行。Runtime 始终重新授权，并以 Runtime 拥有的动作发出，带独立审计血缘。

## 故事 4：跨会话记得用户

用户周一与某 Agent 聊过。周三回来。Agent 应该记得。

1. **写入记忆**。周一的对话里，Agent 把"用户提到 3 月 12 日生日"写进 `AGENT_CORE` 库，由 Cognition 的记忆服务承接。
2. **复制**。Runtime 把记忆复制到 Realm，复制状态走 `pending → synced`。
3. **新会话开始**。周三用户打开聊天。Runtime 通过 Realm 解出用户身份；Agent 身份持久。
4. **Cognition 桥接**。Runtime 通过桥接契约调 Cognition，为新对话解出相关记忆。Cognition 按桥接契约返回记忆；Runtime 不重新定义记忆是什么。
5. **对话锚点**。这次对话有自己的 `ConversationAnchor`——每个 Agent 加每段对话。如果用户稍后在 Avatar 或网页端继续这段对话，anchor 让多个表面共享同一段对话，不塌进全局会话。
6. **APML 输出**。Agent 的 Life Track 与 Chat Track 回合输出以 APML 线协议出来，Runtime 解析为强类型事件后，产品代码才看到。
7. **呈现反映状态**。Avatar 的具身化呈现反映 Agent 当前的情绪 / 姿态 / 注意力，从 Runtime 的呈现流取。

"Agent 跨会话仍是同一个生命体"在架构上就是这副样子。它不是单一一段代码，是 Runtime、Cognition、Realm、Avatar 各守其位的协作。

## 这些故事的共性

| 属性 | 含义 |
| --- | --- |
| 多域 | 每个故事都触及三个或更多权威域 |
| 尊重归属 | 任一域不能重新定义另一个域的真相 |
| 边界中介 | 跨域交互都走已准入契约 |
| 审计可追溯 | 每一步都被记录；用户、审计员、未来实现者都能重建发生过什么 |

架构存在就是让这些故事在没有静默捷径的前提下成立。当某些事看上去意外——云端不在线但 AI 仍能用、外部 AI 不能直接按下按钮——那是架构在按设计执行。

## 来源依据

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
