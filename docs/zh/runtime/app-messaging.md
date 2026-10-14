# 应用间协作与能力集成

在 Nimi 中，应用之间不通过无类型的全局消息总线直接通信，而是通过受保护的宿主会话和明确接纳的 SDK 操作开展协作。这样既能保持各应用的独立边界，又能安全地复用其他应用开放的能力。

## 常用协作接口

| 协作场景 | 推荐 SDK 接口 | 访问控制与生命周期 |
| --- | --- | --- |
| **调用其他应用的服务操作** | `client.integration` | 按类型化 Schema 校验参数，需具备相应调用许可 |
| **与 LocalAgent 对话** | `client.conversation` | 使用当前会话授权的 `agentHandle` 进行多轮对话 |
| **交由 Agent 执行专项任务** | `client.agentWork` | 运行在独立的项目作用域与任务执行通道中 |
| **发布或查看活动事件** | `client.activity` | 遵循事件归属、可见性策略与留存规则 |

## 场景示例：查询日程应用的空闲时段

假设日程应用（如 NimiDay）开放了查询忙闲时段的结构化接口，调用流程如下：

1. **发现能力与获取 Schema**：调用方通过 `client.integration` 查询目标应用声明的接口定义及输入参数 Schema。
2. **确认调用许可**：若当前应用未获准调用该接口，Runtime 会返回 `INTEGRATION_PERMISSION_REQUIRED`，需由用户在 Home 的「集成」工作区授予针对该应用、操作与连接的常设集成权限，再回来重试。该资源权限与受保护 App 会话准入是两层独立检查。
3. **结构化调用与返回**：获准后，调用方传入符合类型要求的参数；日程应用在自身受保护的执行通道内处理请求，并返回结构化的时间段数据。

## 受保护通道与安全边界

为确保运行环境安全可控，Runtime 维持以下边界约束：
- **通道隔离**：Runtime 的内部 Agent 传输通道与外部隔离，应用只能通过受保护宿主会话调用已公开声明并注册的集成接口。
- **身份真实性**：调用方身份由桌面宿主直接核验，应用无法伪造或冒用其他应用的标识。

## Source Basis

- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/integration.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/integration.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform.ts)
