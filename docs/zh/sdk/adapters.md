# 适配器

SDK 的框架适配器放在 base `@nimiplatform/sdk` package 之外。适配器是框架投影，不拥有 Runtime 路由、Realm 真值或 SDK core API 语义。

旧的 `@nimiplatform/sdk/ai-provider` 子路径已删除。它必须 fail closed，不能转发到任何适配器。

## 当前适配器

| 适配器 | 分发方式 | 角色 |
| --- | --- | --- |
| Vercel AI SDK 6 | npm package `@nimiplatform/sdk-adapter-vercel-ai` | 把 Vercel language model 调用映射到 App 绑定宿主的 AI client |
| OpenAI-compatible | 只有源码，位于 `sdks/typescript/adapters/openai-compatible`，没有作为 package 发布 | 把 OpenAI-compatible chat completion 形状映射到 Nimi AI 语义 |

每个适配器版本都用 peer dependency 范围声明它支持的 `@nimiplatform/sdk` 版本。添加适配器前，先确认要安装的版本覆盖 App 当前使用的 SDK 版本。`@nimiplatform/sdk-adapter-vercel-ai` 0.1.0 声明的是 `@nimiplatform/sdk` `^0.13.0`，不能与 SDK 0.14 及以后的版本配对。

适配器可以依赖 `@nimiplatform/sdk/ai`、`@nimiplatform/sdk/ai-runner`、
`@nimiplatform/sdk/runtime` 或 feature module。它不能恢复已删除的 base SDK 子路径。

其他 framework 或 protocol adapter 只在出现具体 consumer 时增加。仅存在
source directory 或 capability ledger row，不代表该 adapter 已成为当前公共
产品 surface。

## 边界

| 关注点 | Owner |
| --- | --- |
| Runtime 路由、provider readiness、审计 | Runtime |
| SDK core AI request/response 语义 | `@nimiplatform/sdk/ai` |
| AI runner 编排语义 | `@nimiplatform/sdk/ai-runner` |
| 框架调用形状映射 | Adapter package |
| OpenAI-compatible request/response bridge | OpenAI-compatible adapter boundary |

适配器遇到不支持的框架能力必须 fail closed。它不得伪造成功、发明 provider capability，也不得绕过 Runtime readiness。

## 读者场景：在 Nimi App 中使用 Vercel AI SDK

基于 Vercel AI SDK 6 的 App 保留 Vercel 的流式输出和由调用方驱动的工具循环，把 App 绑定宿主的 AI client 交给 model：

```ts
import { stepCountIs, streamText } from 'ai';
import { createNimiLocalAppVercelLanguageModel } from '@nimiplatform/sdk-adapter-vercel-ai';
import { getNimiLocalAppClient } from './shell/auth/local-app-client.js';

const model = createNimiLocalAppVercelLanguageModel({ ai: getNimiLocalAppClient().ai });
const result = streamText({
  model,
  prompt: 'Summarize this note in three points.',
  stopWhen: stepCountIs(5),
});
```

适配器把 Vercel 的调用形状映射到 App 的 AI client。路由和执行仍由 Runtime 负责，本地还是云端由 App 的 AIConfig 决定；工具回调和状态仍归 App。图片输入和对话历史的处理方式见该适配器 package 的 README。

## 读者场景：OpenAI-compatible 调用形状

OpenAI-compatible 迁移桥目前只在本仓库中以源码形式存在，没有作为 package 发布，App 无法安装使用。它的设计只在明确支持的范围内保留兼容形状；不支持的 OpenAI-compatible 特性会返回强类型失败，而不是掉到 raw Runtime 或 provider-native bypass。

## 来源依据

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`sdks/typescript/adapters/vercel-ai/README.md`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/README.md)
