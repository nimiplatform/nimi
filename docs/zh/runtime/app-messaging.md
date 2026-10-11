# 应用间协作与能力集成（App Messaging & Integration）

在 Nimi 生态中，不同的应用（App）之间通过定义明确且受权限保护的接口开展协作，避免采用不可控的全局未类型化消息总线。各应用在保持自身独立性的同时，能够安全复用其他应用提供的专业能力。

## 场景化协作接口一览

| 协作场景 | 推荐 SDK 接口 | 核心权限与生命周期 |
| --- | --- | --- |
| **调用其他应用提供的服务操作** | `client.integration` | 基于 Schema 进行参数校验，需用户在集成设置中授予常设权限 |
| **与已授权的 LocalAgent 会话** | `client.conversation` | 使用当前会话的 `agentHandle` 发起多轮对话 |
| **委托 Agent 执行专属项目任务** | `client.agentWork` | 具备独立声明的项目作用域与结果归档机制 |
| **发布或查询应用活动记录** | `client.activity` | 遵循应用归属、可见性策略与生命周期规则 |

## 实践示例：跨应用调用日程空闲时间

当需要从日程应用（如 NimiDay）查询用户未来的空闲时间块时：

1. **服务发现与模式解析**：通过 `client.integration` 查询日历应用声明的 Integration 接口与其参数 Schema。
2. **权限确认**：若当前应用尚未获得调用权限，接口返回 `INTEGRATION_PERMISSION_REQUIRED`，由应用引导用户在 Home 的「集成」工作区中为该调用授予常设权限。
3. **安全调用与结果解析**：获得许可后，应用按照结构化入参发起调用，日历应用在其受保护的执行通道中处理业务逻辑并返回结构化数据，两端数据边界清晰隔离。

## 通信边界与安全保证

为了防止恶意应用干扰底层系统：
- **安全隔离**：Runtime 为内部智能体通信保留了受保护的专用通道，公开应用接口仅能调用经过审核公开声明的能力；
- **防冒名篡改**：应用无法随意构造虚假的应用标识来伪装成其他应用，所有调用的发起方身份均由宿主环境严格担保。

## Source Basis

- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/integration.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/integration.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform.ts)
