# Realm 与 Runtime 的同侪架构

Realm 与 Runtime 是系统架构中平级独立的核心权威域（Authority Domains）。

| 核心职责归属 | Realm 管控范围 | Runtime 管控范围 |
| --- | --- | --- |
| **身份与运行态** | 角色持久身份（Character Identity）与角色源定义（Character Source） | 本地智能体（LocalAgent）的实例化与设备端生命周期 |
| **世界与算力** | 世界源规范（World Source）与权威世界历史 | 本地推理（Ollama/llama.cpp）与云端 AI 模型调度 |
| **状态与会话** | 跨场景社交网络、经济系统与持久世界状态 | 活跃会话、会话状态与记忆调解 |
| **安全与策略** | Realm 访问策略与多端云端审计日志 | 推理驱动选择、Token 预算、API 密钥与应用授权 |

## 协同交互机制

Realm 签发或投影 Character Source 与 World Source，提供经过授权的标准数据定义；Runtime 根据 Character Source 在本地实例化出专属的 LocalAgent，并在执行过程中按需引入已授权的世界上下文。

两者的架构边界严格隔离，防止跨域污染：
- 未经显式校验，Runtime 产生的临时记忆或推理输出绝不会写回 Realm 的权威世界状态；
- Realm 并不干预 LocalAgent 的逐轮对话推理决策，也不指定 Runtime 的具体底层推理驱动；
- 任何跨系统的状态变更，都必须调用归属方明确声明的公开标准契约进行。

SDK 提供了有边界的消费方调用接口。Nimi Home、Desktop 宿主壳层、Avatar 渲染系统以及独立 App 均属于消费方；任何宿主环境都不能将这两个独立的权威合并为私有的本地状态。

> [!NOTE]
> 长期记忆由 Cognition 系统按智能体独立管理；Runtime 仅作为授权数据调度的中介通道。当前版本的知识库系统（Knowledge V1）未开放公共调用接口。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
