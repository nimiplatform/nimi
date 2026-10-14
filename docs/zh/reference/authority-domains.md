# 权威域与架构职责划分（Authority Domains）

Nimi 采用明确的权威域（Authority Domains）划分体系，在分布式架构中为每一类数据、状态与计算模型确立唯一的责任主体。各层之间职责分明，避免了数据所有权模糊与多头冲突。

## 核心权威域权责总览

| 权威域（Domain） | 核心管辖范围 | 明确不涉及的领域 |
| --- | --- | --- |
| **平台核心协议（Platform Protocol）** | 跨世界基础协议规范、系统级安全不变量与接口契约 | 具体的云端存储实现、本地模型计算细节、应用业务逻辑 |
| **Realm 服务端** | 全局用户身份、角色模板（Character）、世界状态与历史、社交图谱、创作者经济 | 本地硬件推理调度、本地模型权重存储、桌面端交互状态 |
| **本地运行时（Runtime）** | 本地模型推理加速、云端连接器托管、LocalAgent 实例化、会话流转、记忆检索中介、受保护通道控制 | 云端全局角色及世界规则的最终定义；前端产品界面渲染 |
| **认知系统（Cognition）** | 智能体私有长期记忆库、语义向量索引与认知沉淀 | 会话通信通道传输、前端 UI 呈现与硬件驱动 |
| **SDK** | 导出类型安全的客户端接口、请求参数校验与结构化错误映射 | 服务端内部存储细节、本地推理引擎实现、私有通信协议 |
| **Kit** | 跨端通用的共享 UI 组件库、交互模式与桌面端辅助布局预设 | 底层权威数据仲裁、专有业务数据所有权 |
| **Nimi Home / Desktop** | 用户主工作台界面、桌面端窗口承载、硬件资源与本地模型管理 | 仲裁 Realm 服务端真值，或越权覆盖本地 Runtime 安全机制 |
| **Avatar 应用** | 虚拟人 2D（Live2D）与 3D（VRM）图形管线渲染、骨骼动画与口型同步 | 智能体长期记忆库、通用 AI 模型路由与会话管理 |
| **第三方应用（App）** | 应用自身的独特产品功能、业务交互逻辑与私有持久化数据 | 平台级全局账号身份、底层模型连接器密钥凭据 |

## 跨域数据流转与协作模式

| 数据流转方向 | 协作机制与数据边界 |
| --- | --- |
| **Realm → Runtime** | Realm 签发标准化的 Character Source，Runtime 据此在本地实例化并运行 LocalAgent |
| **Realm → Runtime** | Realm 托管的世界观上下文为智能体本地对话提供情境参考 |
| **Runtime → SDK** | Runtime 将标准化的生成流与交互状态投影给 SDK |
| **SDK → App** | 应用消费 SDK 提供的公共能力，享受平台受保护通道与本地加速支持 |
| **Runtime → Avatar** | Runtime 输出标准化的呈现事件流，Avatar 在本地 GPU 环境中驱动虚拟形象动效 |
| **Nimi Home → App** | Home 在受保护的 Electron 开发容器中托管应用，Runtime 统一校验权限与会话 |

## 相关文档

- [统一术语表](/zh/reference/glossary)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
