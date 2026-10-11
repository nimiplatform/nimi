# Realm 与 Runtime 的同侪架构

Realm 与 Runtime 是系统架构中平级独立的核心权威域（Authority Domains）。

| 核心职责归属 | Realm 管控范围 | Runtime 管控范围 |
| --- | --- | --- |
| **身份与运行态** | 角色持久化身份（Character Identity）与角色源（Character Source） | 本地智能体（LocalAgent）的实例化与运行生命周期 |
| **世界与算力** | 世界源描述（World Source）与数字世界权威客观事实 | 本地推理（Ollama/llama.cpp）与云端大模型 API 资源调度 |
| **状态与会话** | 跨场景社交网络、经济系统、世界状态与历史变迁 | 实时会话管理、智能体短期上下文与记忆检索路由 |
| **安全与准入** | Realm 资源访问策略与云端多端审计 | AI 驱动实现选择、Token 预算控制、密钥安全与应用调用鉴权 |

## 协同交互机制

Realm 签发或投影 Character Source 与 World Source，提供经过授权的标准数据定义；Runtime 根据 Character Source 在本地实例化出专属的 LocalAgent，并在执行过程中按需引入已授权的世界上下文。

两者的职责严格隔离：
- Runtime 运行态生成的临时记忆与推理数据，绝不会绕过安全规则直接写回成为 Realm 的权威世界状态；
- Realm 并不干预 LocalAgent 的逐轮对话推理决策，也不指定 Runtime 的具体底层推理驱动；
- 任何跨系统的状态变更，都必须调用归属方明确声明的公开标准契约进行。

SDK 作为统一的消费方接口，为上层应用提供调用表面。Nimi Home、Desktop 桌面客户端、Avatar 渲染系统以及各独立应用均属于服务消费方，任何客户端均不得将两者的权威状态私自合并为本地未经受控的混合状态。

> [!NOTE]
> 长期记忆由 Cognition 系统按智能体独立管理；Runtime 仅作为授权数据调度的中介通道。当前版本的知识库系统（Knowledge V1）未开放公共调用接口。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
