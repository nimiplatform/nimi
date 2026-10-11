# 系统架构总览

Nimi 采用同侪系统协作架构，各个系统域通过标准化的类型安全视图与接口进行交互解耦。

```text
Realm 角色持久化身份与世界权威状态
            │
            │ Character Source（角色源描述） / World Source（世界源描述）
            ▼
Runtime LocalAgent 运行态与本地/云端 AI 执行
            │
            │ SDK 标准化受控能力视图
            ▼
Nimi Home / Desktop 宿主 / Avatar 具身渲染 / 第三方应用（Apps）
```

Realm 与 Runtime 彼此保持独立同侪关系：Runtime 绝不会演变为 Realm 的内部子系统，Realm 也不会介入本地 AI 算力的具体推理执行。SDK 是一道统一的客户端调用边界，而非凌驾于系统之上的第三方权力仲裁者。

Nimi Home 承载了当前本地应用的运行环境，并整合了公共 SDK 接口与按需加载的 Kit 高保真组件。通过脚手架构建的应用程序仅基于受保护会话获取操作权限，无法越权访问特权密钥或底层运行时凭据。

Avatar 系统依据 Runtime 提供的结构化呈现指令渲染形象，独立管理视线与动作等渲染器局部状态，不干涉 Runtime 的模型推理决策或 Realm 的角色持久化身份。

## 核心架构原则

- **身份与世界数据归属 Realm**：角色静态身份（Character Identity）与数字世界客观事实始终由 Realm 权威持久化。
- **运行态与执行归属 Runtime**：本地智能体（LocalAgent）、实时会话管理、模型推理调度与应用鉴权统一由 Runtime 管控。
- **长期记忆由 Cognition 专属性管理**：智能体私有长期记忆由 Cognition 负责存储与维护，Runtime 提供受控的检索通道；Knowledge V1 暂未开放公共接口。
- **应用专注交互与数据**：第三方应用通过 SDK 标准接口发起调用，仅管理自身交互与产品私有数据。
- **宿主环境松耦合解耦**：桌面客户端是当前首选的第一方宿主，而非不可替换的特权系统。
- **安全以结果为导向**：系统安全通过声明式的保护结果来衡量，底层操作系统特定的隔离机制属于各子系统的内部实现细节，不向公共接口泄露。
- **非阻塞性渐进演进**：未来远期能力不作为运行当前本地核心产品闭环的前置依赖。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
