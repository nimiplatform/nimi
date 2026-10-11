# Agent 记忆机制（Memory）与知识库边界

在 Nimi 的智能体认知体系中，长期记忆（Long-term Memory）及其演进生命周期由 Cognition 模块专门管理。本地运行时（Runtime）则负责管理 LocalAgent 身份、会话上下文组装以及提供安全的记忆检索中介桥梁。

## 智能体记忆隔离与所有权原则

- **独立记忆空间**：每个 LocalAgent 拥有完全独立的专属记忆库（Memory Bank）。即使由同一个角色（Character）模板派生出的不同实例，彼此间的日常对话记忆也互不相通。
- **世界规则为基准**：数字世界的历史轨迹与设定由 Realm 统一提供单一权威源；智能体私有的记忆仅记录其个体的交互经历，不能单方面改写世界的基础设定。
- **权限安全访问**：所有针对记忆库的读写请求均需经过 Runtime 的会话凭证校验。前端应用通过结构化的 SDK 接口调用记忆功能，无法读取未经授权的其他智能体记忆。

## 对话规划中的记忆检索与召回

当用户发起新一轮对话时，系统经历以下上下文组装过程：

1. **会话上下文捕获**：Runtime 提取当前会话的最新进展与历史轮次。
2. **相关记忆召回**：Runtime 向 Cognition 发送语义检索请求，根据用户输入意图召回高度相关的长期记忆片段。
3. **弹性容错保障**：记忆召回属于增强性特征。若向量索引尚未构建完成或未检索到相关内容，系统将优雅返回空集，确保基础对话流畅进行而不被阻塞。
4. **记忆持久化写入**：当本轮对话交互包含关键信息时，Cognition 在后台评估并沉淀新的记忆条目。

## 记忆库的开关与数据生命周期管理

- **独立记忆开关**：每个 LocalAgent 拥有专属的记忆开关。开启状态下会自动沉淀记忆，关闭后停止接收新记忆与召回，但已有的历史记忆将安全保留。
- **记忆清空**：用户可在设置中选择清空特定 Agent 的记忆数据。清空后该 Agent 的记忆库不再返回旧有记忆，但原始对话记录与基础角色设定不受影响。
- **账户注销联动**：当观察到 Realm 确认的 `ACCOUNT_DELETED` 结果时，本地 Runtime 会清理本设备该账户命名空间下的私有记忆库，全面保障用户隐私。

## Source Basis

- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
