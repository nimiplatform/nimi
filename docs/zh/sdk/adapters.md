# 框架适配器

适配器负责将第三方生态框架的调用桥接至 Nimi AI 客户端。Runtime 继续负责模型路由与执行，App 则专注于工具回调、界面交互与自身业务状态。

## 区分发布包与源码开发包

| 制品 | 版本与配对关系 | 在本指南中的定位 |
| --- | --- | --- |
| npm 已发布的 Vercel 适配器 | 0.1.0；AI SDK 6、provider 3、SDK ^0.13.0 | 早期公开发布制品，不可与当前源码示例混用 |
| 当前工作区 Vercel 适配器源码 | 0.5.0；AI SDK ^7.0.0、provider ^4.0.0、SDK ^0.21.0 | 下方示例采用此组合，通过本地开发归档或开发交付包提供 |
| OpenAI-compatible 适配器 | 仅存在于源码，未公开发布至 npm | 仅用于内部测试及明确支持的兼容子集 |

已发布的 0.1.0 版本声明请参阅 [npm 制品元数据](https://registry.npmjs.org/@nimiplatform%2fsdk-adapter-vercel-ai/0.1.0)。源码清单中的版本号并不代表该版本已正式发布。当前 App 的开发环境准备请参考[开发环境准备](/zh/start/install)。

## 在当前源码 App 中使用 Vercel AI SDK 7

请确保具备 SDK 0.21.0、配套的 Kit/Runtime 构建产物，以及适配器 0.5.0 源码的本地开发归档。直接复用 App 宿主绑定的客户端实例：

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
