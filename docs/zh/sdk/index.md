---
aside: false
---

# SDK

Nimi SDK 是 App 面向 Runtime、Realm、AI、Agent、feature 与共享类型的公开边界。
当前实现位于 `sdks/typescript`，即公开的 `@nimiplatform/sdk` package。

## 从这里开始：Nimi App

Nimi App 只使用一个绑定宿主的 client。Nimi Home 在受管宿主中启动 App，宿主注入标准 shell，Runtime 再从这条受保护会话确定当前账号、App 身份和访问范围。App 不需要自己提供 App ID、账号、token 或 Runtime 地址。

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

用 App Tools 创建的项目已经在 `src/shell/auth/local-app-client.ts` 中包含这个 client，直接复用即可。接下来通过它完成[第一次 AI 调用](/zh/sdk/first-ai-call)。

## 其他入口与适用对象

| 入口 | 适用场景 |
| --- | --- |
| `client.ai.text.generateCandidate` | App 需要一次文本回答。[第一次 AI 调用](/zh/sdk/first-ai-call)给出完整步骤。 |
| `client.aiConfig` | App 读取或保存自己的能力意图，见 [AI 配置](/zh/sdk/ai-config-surface)。 |
| `@nimiplatform/sdk/ai` 中的 `createNimiLocalAppTextModel(client.ai)` | App 自己驱动多步工具循环、需要 JSON 输出或发送图片内容。它使用同一个绑定宿主的 client。 |
| `@nimiplatform/sdk-adapter-vercel-ai` 中的 `createNimiLocalAppVercelLanguageModel({ ai: client.ai })` | App 基于 Vercel AI SDK 6 构建。它是独立 package，版本配对见[适配器](/zh/sdk/adapters)。 |
| `createNimiClient({ appId, runtime, realm })` | Nimi App 之外的独立程序，例如自行登录 Realm、自行保存 token 的脚本。 |

最后一种入口返回的是直连 `NimiClient`，不是 App client。配置里的 App ID 不会带来任何访问权限。通过普通的本机 gRPC 连接，Runtime 会以 `PROTECTED_ORIGIN_ROLE_MISMATCH` 拒绝 App 范围内的操作，例如 AI 执行与 Job、App AIConfig、App 存储和 Agent Conversation。不要用它替换 App 绑定宿主的 client。

## 接入面

<SdkSurfaces />

## 本节包含

- [边界](/zh/sdk/boundaries)：App 必须遵守的导入与调用规则。
- [第一次 AI 调用](/zh/sdk/first-ai-call)：通过 App 绑定宿主的 client 完成一次文本生成。
- [AI 配置](/zh/sdk/ai-config-surface)：App 自己的能力意图。
- [Runtime Client](/zh/sdk/runtime-client)：强类型 Runtime 投影及其支持的使用场景。
- [Realm 与组合](/zh/sdk/realm-world-client)：Realm 真值与已准入的世界相关组合，不恢复 `@nimiplatform/sdk/world`。
- [适配器](/zh/sdk/adapters)：外部框架适配器，例如 `@nimiplatform/sdk-adapter-vercel-ai`。
- [共享类型](/zh/sdk/types)：可移植的公开类型与错误。

## 公开 surface

TypeScript SDK 只有一个 base package。外部框架适配器是独立 package，不是 base SDK 子路径。

| 公开入口 | 角色 |
| --- | --- |
| `@nimiplatform/sdk` | `createNimiClient` 与共享公开导出；App 在这里创建绑定宿主的 client |
| `@nimiplatform/sdk/app` | 绑定宿主的 App client、标准 shell contract 与强类型 App 操作 |
| `@nimiplatform/sdk/ai` | model 接口，包括 App 文本 model 绑定 |
| `@nimiplatform/sdk/runtime` | 面向其支持场景的强类型 Runtime client；不能绕过 App 授权 |
| `@nimiplatform/sdk/realm` | 供自行完成认证的独立程序使用的 Realm client；App 通过 App client 执行 Realm 操作 |
| `@nimiplatform/sdk/types` | 共享公开类型与 SDK 错误 |
| `@nimiplatform/sdk/contracts` | 公开 contract descriptor |
| `@nimiplatform/sdk/ai-runner` | 框架无关的 AI runner facade |
| `@nimiplatform/sdk/testing` | SDK 消费者测试 helper |
| `@nimiplatform/sdk/features/*` | 由具体 consumer contract 驱动的 feature module |

已删除的子路径必须 fail closed：`@nimiplatform/sdk/world`、
`@nimiplatform/sdk/scope`、`@nimiplatform/sdk/ai-provider`、
`@nimiplatform/sdk/ai-app` 以及旧 runtime 兼容子路径都不得转发。

## SDK 为什么存在

Nimi 有多个 owner domain。Runtime 持有执行、LocalAgent Conversation、Memory
与 Knowledge；Realm 持有 Character、World、social 与 semantic truth；
Desktop 持有原生 shell 行为。App 需要稳定使用这些域，而不是导入它们的私有实现。

SDK 就是这条边界。它把已准入的 owner-domain 行为投影成开发者可用的
TypeScript API。它不自创 Runtime、Realm 或 Desktop 真值。

## 读者场景：第一次接入

一个同时需要 Realm 数据和 Runtime-backed generation 的 App 应该：

1. 复用生成的、绑定宿主的 client，不再用 App ID 或地址另建第二个 client。
2. 通过 `client.aiConfig` 或生成的 AI 设置保存所需能力意图，例如 `text.generate`。
3. 通过 `client.ai` 执行 AI 工作。第一次文本生成从[第一次 AI 调用](/zh/sdk/first-ai-call)开始。
4. 通过 App client 的 Realm 操作读取 Realm World 与 PersonaCharacter。
5. 按 reason code 处理强类型错误，并保留实际错误供用户查看。

这个 App 不导入 Runtime 内部、Realm REST route，也不使用已删除的 SDK 兼容路径。

## 来源依据

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`runtime/internal/grpcserver/interceptor_public_transport.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/grpcserver/interceptor_public_transport.go)
