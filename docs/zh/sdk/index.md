---
aside: false
---

# SDK

Nimi SDK 是 App 面向 Runtime、Realm、AI、Agent、feature 与共享类型的公开边界。
当前实现位于 `sdks/typescript`，即公开的 `@nimiplatform/sdk` package。

App 应优先从根包开始：

```ts
import { createNimiClient } from '@nimiplatform/sdk';
```

根 client 用显式 app identity 组合已准入的 Runtime 与 Realm surface。专用子路径仍可用于更低层或特定领域的使用。

## 接入面

<SdkSurfaces />

## 本节包含

- [边界](/zh/sdk/boundaries)：App 必须遵守的导入与调用规则。
- [第一次 AI 调用](/zh/sdk/first-ai-call)：通过 `createNimiClient` 走 Runtime-backed 文本生成的最短路径。
- [Runtime Client](/zh/sdk/runtime-client)：App 进入 Runtime 的公开路径。
- [Realm 与组合](/zh/sdk/realm-world-client)：Realm 真值与已准入的世界相关组合，不恢复 `@nimiplatform/sdk/world`。
- [适配器](/zh/sdk/adapters)：外部框架适配器，例如 `@nimiplatform/sdk-adapter-vercel-ai`。
- [共享类型](/zh/sdk/types)：可移植的公开类型与错误。

## 公开 surface

TypeScript SDK 只有一个 base package。外部框架适配器是独立 package，不是 base SDK 子路径。

| 公开入口 | 角色 |
| --- | --- |
| `@nimiplatform/sdk` | 推荐的 App 级组合入口 |
| `@nimiplatform/sdk/runtime` | Runtime facade 与强类型 Runtime 投影 |
| `@nimiplatform/sdk/realm` | Realm facade 与生成 Realm client 边界 |
| `@nimiplatform/sdk/app` | App identity 与 App-facing helper |
| `@nimiplatform/sdk/types` | 共享公开类型与 SDK 错误 |
| `@nimiplatform/sdk/contracts` | 公开 contract descriptor |
| `@nimiplatform/sdk/ai` | 原生 AI model generation surface |
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

1. 用显式 app identity 创建 root client。
2. 通过 `client.realm` 或 `@nimiplatform/sdk/realm` 读取 Realm 数据。
3. 通过 `client.runtime`、`@nimiplatform/sdk/runtime` 或原生 `@nimiplatform/sdk/ai` helper 执行 Runtime 工作。第一次文本生成从 [第一次 AI 调用](/zh/sdk/first-ai-call) 开始。
4. 只有当已准入 feature contract 匹配具体产品需求时，才使用 `@nimiplatform/sdk/features/*`。
5. 将可移植 id、reason code 与公开错误放在 `@nimiplatform/sdk/types`。

这个 App 不导入 Runtime 内部、Realm REST route，也不使用已删除的 SDK 兼容路径。

## 来源依据

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
