---
aside: false
---

# SDK 开发指南

Nimi SDK 是 App 面向 Runtime、Realm、AI 推理、Agent 协作、扩展 Feature 以及共享类型的官方集成边界。当前核心实现在 `sdks/typescript`，即公开发布的 `@nimiplatform/sdk` npm 包。

以下宿主绑定示例使用 SDK 0.21.0 的源码开发组合及匹配 Kit/Runtime。先按[环境准备](/zh/start/install)提供本地归档或开发交付包；Vercel 示例使用源码 adapter 0.5.0 和 AI SDK 7，已发布制品的不同配对见[适配器](/zh/sdk/adapters)。

## 快速上手：Nimi App 开发

对于标准的 Nimi App，开发时**只需使用一个绑定宿主会话的客户端 (Host-bound Client)**。当 Nimi Home 在受监管的桌面宿主中启动 App 时，宿主会自动注入标准 Shell 桥接，底层 Runtime 会直接从该受保护会话中解析当前登录账号、App 身份标识与对应权限范围。App ID 仍需在项目清单中声明；业务调用从宿主获取身份，无需逐次传入 App ID、账号凭证、Token 或 Runtime 监听端口。

```ts
import { createNimiClient, type NimiLocalAppClient } from '@nimiplatform/sdk';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

let client: NimiLocalAppClient | null = null;

export function getNimiLocalAppClient(): NimiLocalAppClient {
  client ??= createNimiClient({
    localApp: { standardShell: createNimiLocalAppStandardShellSurface() },
  });
  return client;
}
```

使用 Nimi 官方工具链创建的项目已在 `src/shell/auth/local-app-client.ts` 中内置了此初始化封装，直接复用即可。接下来可以通过它快速完成[第一次 AI 调用](/zh/sdk/first-ai-call)。

## 常用 API 入口与适用场景

| API 入口 | 适用场景与推荐实践 |
| --- | --- |
| `client.ai.text.generateCandidate` | App 需要标准单轮文本生成。完整步骤请参阅[第一次 AI 调用](/zh/sdk/first-ai-call)。 |
| `client.aiConfig` | App 查询或持久化自身的 AI 能力偏好设置。详见 [AI 配置](/zh/sdk/ai-config-surface)。 |
| `createNimiLocalAppTextModel(client.ai)` (位于 `@nimiplatform/sdk/ai`) | App 需要驱动多轮 Tool-calling 循环、结构化 JSON 输出或图文多模态内容，底层复用同一宿主客户端。 |
| `createNimiLocalAppVercelLanguageModel({ ai: client.ai })` (位于 `@nimiplatform/sdk-adapter-vercel-ai`) | App 基于 Vercel AI SDK 7 生态构建。作为独立适配器包分发，版本对照见[适配器](/zh/sdk/adapters)。 |
| `createNimiClient({ appId, runtime, realm })` | 仅适用于 App 外部的独立守护进程或测试脚本（自行维护 Realm 鉴权与 Token 会话）。 |

> [!WARNING]
> 最后一种 `createNimiClient({ appId, ... })` 返回的是直连式 `NimiClient`，而非 App 宿主客户端。仅在配置中传入 App ID 并不会赋予任何受管权限。通过普通本机 gRPC 连接时，Runtime 会以 `PROTECTED_ORIGIN_ROLE_MISMATCH` 严格拒绝 App 专属操作（如 AI 执行、Job 调度、App AIConfig、本地安全存储及 Agent 会话）。切勿在 App 内部使用它取代宿主客户端。

## SDK 架构表面

<SdkSurfaces />

## 章节导航

- [边界规范](/zh/sdk/boundaries)：App 必须遵守的代码导入与 API 调用准则。
- [第一次 AI 调用](/zh/sdk/first-ai-call)：通过宿主绑定客户端完成开箱即用的文本生成。
- [AI 配置](/zh/sdk/ai-config-surface)：管理 App 专属的模型偏好与路由意图。
- [Runtime Client](/zh/sdk/runtime-client)：面向受支持场景的强类型 Runtime 客户端用法。
- [Realm 与组合](/zh/sdk/realm-world-client)：消费 Realm 权威状态与规范支持的世界级组合能力。
- [适配器](/zh/sdk/adapters)：对接第三方生态框架的扩展包（如 `@nimiplatform/sdk-adapter-vercel-ai`）。
- [共享类型](/zh/sdk/types)：可复用的公共类型定义与标准错误模型。

## 公共导出子路径

TypeScript SDK 保持单一基础包设计，针对外部框架的适配层作为独立包分发：

| 公开子路径 / 包名 | 职责与定位 |
| --- | --- |
| `@nimiplatform/sdk` | 核心工厂函数 `createNimiClient` 与通用公共导出；App 创建宿主客户端的主入口 |
| `@nimiplatform/sdk/app` | 宿主绑定 App 客户端类型、标准 Shell 契约与高阶强类型操作 |
| `@nimiplatform/sdk/ai` | AI Model 基础接口与文本模型绑定工具 |
| `@nimiplatform/sdk/runtime` | 强类型 Runtime 客户端；用于受信任场景，无法绕过 App 权限约束 |
| `@nimiplatform/sdk/realm` | 独立 Realm 客户端，供外部脚本使用；App 内通常通过宿主客户端访问 Realm |
| `@nimiplatform/sdk/types` | 全局通用类型定义与标准化 SDK 错误模型 |
| `@nimiplatform/sdk/contracts` | 开放的协议契约描述符 (Contract Descriptors) |
| `@nimiplatform/sdk/ai-runner` | 框架无关的 AI 执行器门面 (Runner Facade) |
| `@nimiplatform/sdk/testing` | 面向 SDK 消费者的测试辅助工具 |
| `@nimiplatform/sdk/features/*` | 按需演进的业务特性模块 |

早期废弃的历史子路径（如 `@nimiplatform/sdk/world`、`@nimiplatform/sdk/scope`、`@nimiplatform/sdk/ai-provider` 等）已全部永久下线，直接引用将触发编译阻断。

## SDK 的定位与核心价值

Nimi 系统拥有清晰的所有权域划分：Runtime 管理执行环境与本地 Agent 会话；Cognition 沉淀长期记忆；Realm 维护角色设定、虚拟世界与社交图谱的权威状态；Desktop 负责底层原生 Shell 交互。

应用层代码需要以稳定、优雅且安全的方式使用这些底层能力，而无需关心内部私有实现。SDK 正是这条标准契约边界——它将底层各域的规范能力投射为符合 TypeScript 习惯的高质量 API，同时保证平台单一可信源的完整性。

## 典型场景：App 首次接入平台能力

一个需要读取 Realm 数据并调用本地 AI 生成的 App 应当：

1. **复用宿主客户端**：直接使用模板预置的宿主绑定 client，无需自行实例化第二个 client。
2. **声明所需能力**：通过 `client.aiConfig` 或预置的配置界面声明 `text.generate` 等所需意图。
3. **调用 AI 推理**：通过 `client.ai` 发起生成任务，参考[第一次 AI 调用](/zh/sdk/first-ai-call)。
4. **访问 Realm 资源**：通过宿主客户端提供的 Realm 接口安全查询虚拟世界与角色资料。
5. **规范处理异常**：根据标准错误中的 Reason Code 编写健壮的容错逻辑，并保留必要信息供用户排查。

App 无需、也不应该直接拼接内部 gRPC 地址或 Realm REST 路由，遵循标准 SDK 即可获得最佳的稳定性与跨版本兼容保障。

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`runtime/internal/grpcserver/interceptor_public_transport.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/grpcserver/interceptor_public_transport.go)
