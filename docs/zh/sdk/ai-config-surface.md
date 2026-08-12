# AI Config Surface

SDK AIConfig surface 提供 owner-scoped AI 能力意图的类型边界。App 记录需要的 capability contract、required features、portable defaults，以及 Local 或 Cloud 执行平面意图。机器配置和具体实现选择归 Runtime 管理。

AIConfig 是一个 owner 当前配置的完整值。更新操作会替换整个 capability 列表；配置中没有 revision history、execution binding、readiness 或 health 状态。

## 当前公开部分

| 部分 | 公开路径 | 作用 |
| --- | --- | --- |
| AIConfig types | `@nimiplatform/sdk` 或 `@nimiplatform/sdk/ai` | 提供 `NimiCapabilityAIConfig` 和 `NimiCapabilityAIConfigIntent` |
| App owner helper | `@nimiplatform/sdk/ai` | 从 App ID 创建显式 owner assertion |
| App AIConfig client | `@nimiplatform/sdk/ai` | 读取或整体覆盖 Runtime 管理的 App AIConfig |
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

1. 使用准确的 App ID 创建 Nimi client。
2. 在 `client.runtime` 上创建 typed App AIConfig client。
3. 读取当前完整配置。
4. owner 修改意图时，整体覆盖 capability 列表。
5. 通过常规 SDK feature surface 提交 AI 工作，请求只携带身份、内容和受支持参数。

```ts
import {
  createNimiAppAIConfigClient,
  createNimiClient,
} from '@nimiplatform/sdk';

const client = createNimiClient({ appId: 'example.sdk.hello' });
const aiConfig = createNimiAppAIConfigClient({
  appId: 'example.sdk.hello',
  runtime: client.runtime,
});

await aiConfig.overwrite([{
  capabilityContract: 'text.generate',
  requiredFeatures: [],
  route: {
    oneofKind: 'local',
    local: {},
  },
}]);
```

请求中的 owner 只用于一致性断言。Runtime 仍从 authenticated transport context 取得 account 和 App 身份。

执行调用见[第一次 AI 调用](/zh/sdk/first-ai-call)。AI 请求不会将能力意图解析成 model、route、connector、target reference 或 fallback policy。

## Fail-Closed 行为

SDK 会拒绝格式错误的 App ID、owner 不一致、返回配置缺失，以及非数组的 overwrite 输入。Runtime 会在负责该操作的边界通过 typed error 拒绝意图缺失、Cloud 使用未授权、能力要求不受支持或当前无法执行的请求。

App 应保留这些错误。不要替换成 `auto`，不要硬编码 provider 或 model，不要建立本地排名，也不要通过 App-owned REST 绕过 Runtime。

## Runtime 管理的状态

机器配置、已安装 asset、Driver state、readiness、health 和执行诊断都是 Runtime 事实。诊断输出可以解释已经完成或失败的调用，但不会赋予 App 请求侧实现选择权。

## 来源依据

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`sdks/typescript/core/ai/capability-configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/capability-configuration.ts)
- [`sdks/typescript/core/ai/config.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config.ts)
- [`sdks/typescript/core-generated/runtime-protobuf/runtime/v1/capability_configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core-generated/runtime-protobuf/runtime/v1/capability_configuration.ts)
- [`kit/features/agent-center/src/components/AgentCenterAIConfigSection.tsx`](https://github.com/nimiplatform/nimi/blob/main/kit/features/agent-center/src/components/AgentCenterAIConfigSection.tsx)
- [`apps/tester/src/tester/tester-run-target.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-run-target.ts)
