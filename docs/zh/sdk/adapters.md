<!-- nimi-docs: {"authority":[],"sources":["sdks/typescript/adapters/vercel-ai/package.json","sdks/typescript/adapters/vercel-ai/index.ts",".nimi/spec/sdks/feature-clients.authority.yaml"]} -->

# 框架适配器

适配器负责将第三方生态框架的调用桥接至 Nimi AI 客户端。Runtime 继续负责模型路由与执行，App 则专注于工具回调、界面交互与自身业务状态。

## 选择适配器与依赖

已发布的 `@nimiplatform/sdk-adapter-vercel-ai@0.6.2` 声明 SDK `^0.22.2`、AI SDK `^7.0.0`、`@ai-sdk/provider` `^4.0.0`，返回 `LanguageModelV4`。完整制品选择与源码入口限制见[环境准备](/zh/start/install)。历史适配器 `0.1.0` 面向 AI SDK 6，不适用于本页示例。

安装所选组合后，复用原生 App 的当前宿主客户端：

```ts
import { stepCountIs, streamText } from 'ai';
import { createNimiLocalAppVercelLanguageModel } from '@nimiplatform/sdk-adapter-vercel-ai';
import { getNimiLocalAppClient } from './shell/auth/local-app-client.js';

const model = createNimiLocalAppVercelLanguageModel({
  ai: getNimiLocalAppClient().ai,
});

const result = streamText({
  model,
  prompt: '请用三句话总结这份笔记。',
  stopWhen: stepCountIs(5),
});
```

当前源码适配器返回 `LanguageModelV4` 实例，无法与 AI SDK 6 配对。实际执行还依赖 App 既有的 `AIConfig`、能力声明以及当前的有效会话；适配器不自带凭据、不保证模型就绪状态，也无法绕过平台的权限校验。

## 其他入口

请在各自约定的契约范围内使用公开的 AI runner、Runtime 与 AI 工具子路径。已退役的旧子路径 `@nimiplatform/sdk/ai-provider` 不再转发至任何适配器。

OpenAI-compatible 适配器仅覆盖源码中明确支持的 API 子集；它未作为独立包发布，既不能用于直连私有 Runtime 接口，也无法绕过平台的能力校验。

## Source Basis

- [`sdks/typescript/adapters/vercel-ai/package.json`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/package.json)
- [`sdks/typescript/adapters/vercel-ai/index.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/index.ts)
- [`sdks/typescript/adapters/vercel-ai/README.md`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/README.md)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
