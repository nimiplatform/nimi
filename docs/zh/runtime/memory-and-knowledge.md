# Agent 记忆机制（Memory）与知识库边界

在 Nimi 的认知架构中，长期记忆（Long-term Memory）的生命周期与提炼由 Cognition 统一负责。本地运行时（Runtime）负责管理 LocalAgent 运行身份、组装会话轮次上下文，并在 Agent 会话与记忆存储之间充当安全的中介代理。

## 智能体记忆隔离与所有权原则

- **独立记忆库**：每个 LocalAgent 拥有独立的专属记忆库（Memory Bank）。即使由同一个角色（Character）原型派生出的不同实例，彼此间的经历与记忆也严格隔离。
- **世界规则权威不变**：数字世界的历史轨迹与设定以 Realm 为权威来源；Agent 的私有记忆仅记录自身交互经历，不能单方面改写共享的世界设定或全局状态。
- **会话级访问控制**：所有针对记忆库的读写请求均需通过 Runtime 的授权校验。客户端应用通过结构化 SDK API 访问记忆，设计上杜绝跨 Agent 越权窃听。

## 上下文组装与记忆召回流程

当用户发起一轮新对话时，系统按阶段组装上下文：

1. **会话上下文捕获**：Runtime 提取最近的对话轮次与当前会话锚点。
2. **语义记忆召回**：Runtime 向 Cognition 发送语义检索请求，召回与用户意图相关的记忆片段。
3. **弹性降级机制**：记忆召回属于增强能力。准备中、不可用与未命中仍是不同状态。召回无法提供内容时，Runtime 使用零条可选记忆并继续处理其他已准入上下文，不把读取失败伪装为空结果成功。
4. **记忆持久化沉淀**：当有意义的交互轮次结束时，Cognition 在后台评估关键里程碑并持久化写入巩固后的记忆。

## 记忆库的开关与生命周期管理

- **独立记忆开关**：每个 LocalAgent 都有独立的记忆开关。关闭后将停止吸纳新记忆和执行召回，但已保存在库中的历史记忆不受影响。
- **记忆清空**：用户可随时清空特定 Agent 的记忆库；清空后旧记忆不再参与召回，但原始对话记录与底层角色人设保持完好。
- **账户注销清理**：当收到 Realm 确认的类型化 `ACCOUNT_DELETED` 结果时，Runtime 会在当前设备上清理该账户命名空间对应的本地记忆库。

## Source Basis

- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
