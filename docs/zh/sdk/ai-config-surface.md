# AI Config Surface

SDK AIConfig surface 提供 owner-scoped AI 能力意图的类型边界。App 记录需要的 capability contract、required features、portable defaults，以及 Local 或 Cloud 执行平面意图。机器配置和具体实现选择归 Runtime 管理。

AIConfig 是一个 owner 当前配置的完整值。更新操作会替换整个 capability 列表；配置中没有 revision history、execution binding、readiness 或 health 状态。

## 当前公开部分

| 部分 | 公开路径 | 作用 |
| --- | --- | --- |
| App client 上的 App AIConfig | 绑定宿主的 `NimiLocalAppClient` 上的 `client.aiConfig` | 读取 App 自己的 AIConfig 与生效选择，列出可选项，并按 revision 整体覆盖 |
| AIConfig 设置界面 | `@nimiplatform/kit/features/model-config` 中的 `ModelConfigAIConfigSurface` | 生成的 App 在 `client.aiConfig` 之上渲染的设置界面 |
| AIConfig types | `@nimiplatform/sdk` 或 `@nimiplatform/sdk/ai` | 提供 `NimiCapabilityAIConfig`、`NimiCapabilityAIConfigIntent` 以及快照和覆盖结果类型 |
| owner-scoped AIConfig client | `@nimiplatform/sdk/ai` 中的 `createNimiAppAIConfigClient` | 供已经持有受保护 Runtime 传输的宿主使用，不是 App 的接入路径 |
| Agent Center AIConfig section | `@nimiplatform/kit/features/agent-center` | 展示 owner-scoped Local 或 Cloud 能力意图 |

## 能力意图

每个 capability entry 包含：

| 字段 | 含义 |
| --- | --- |
| `capabilityContract` | 所需能力合同，例如 `text.generate` |
| `requiredFeatures` | Runtime 选择的实现必须支持的功能 |
| `defaults` | 可跨机器使用的场景默认值，不是机器或 provider 配置 |
| Local 或 Cloud intent | consumer 期望使用的执行平面 |

Local intent 不包含 implementation identity、machine selection、asset、binding、Driver state、readiness 或 health。App 也应省略 generated wire 中可能尝试指定 Cloud implementation 或 provider-model target 的可选字段。

## App 集成流程

1. 复用 App 绑定宿主的 client；Runtime 会从受保护会话确定 App 这个 owner。
2. 用 `client.aiConfig.get()` 读取当前完整配置及其 revision。
3. owner 修改意图时，带上该 revision 整体覆盖 capability 列表，并保留没有变化的能力。
4. 如果结果是 `conflict`，展示较新的配置，让 owner 重新决定。
5. 通过 `client.ai` 提交 AI 工作，请求只携带内容和受支持的参数。

```ts
import type { NimiLocalAppClient, NimiPortableAppAIConfigIntent } from '@nimiplatform/sdk';

export async function useLocalTextGeneration(client: NimiLocalAppClient) {
  const current = await client.aiConfig.get();
  const textGeneration: NimiPortableAppAIConfigIntent = {
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  };
  const others = (current.config?.capabilities ?? [])
    .filter((capability) => capability.capabilityContract !== 'text.generate');
  return await client.aiConfig.overwrite({
    expectedRevision: current.revision,
    capabilities: [...others, textGeneration],
  });
}
```

同一个函数在 [`examples/sdk/03-ai-config.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/03-ai-config.ts) 中参与编译检查。App client 不发送 owner、账号或 Loadout 选择；带 App ID 的直连 client 无法读取或写入 App 的 AIConfig。

执行调用见[第一次 AI 调用](/zh/sdk/first-ai-call)。AI 请求不会将能力意图解析成 model、route、connector、target reference 或 fallback policy。

## Fail-Closed 行为

SDK 会在发送前拒绝格式错误的能力意图或缺失的 revision，也会拒绝格式错误的返回配置。Runtime 会在负责该操作的边界通过 typed error 拒绝意图缺失、Cloud 使用未授权、能力要求不受支持或当前无法执行的请求。

App 应保留这些错误。不要替换成 `auto`，不要硬编码 provider 或 model，不要建立本地排名，也不要通过 App-owned REST 绕过 Runtime。

## Runtime 管理的状态

机器配置、已安装 asset、Driver state、readiness、health 和执行诊断都是 Runtime 事实。诊断输出可以解释已经完成或失败的调用，但不会赋予 App 请求侧实现选择权。

## 来源依据

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts)
- [`sdks/typescript/core/ai/capability-configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/capability-configuration.ts)
- [`sdks/typescript/core-generated/runtime-protobuf/runtime/v1/capability_configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core-generated/runtime-protobuf/runtime/v1/capability_configuration.ts)
- [`kit/features/agent-center/src/components/AgentCenterAIConfigSection.tsx`](https://github.com/nimiplatform/nimi/blob/main/kit/features/agent-center/src/components/AgentCenterAIConfigSection.tsx)
