# 框架适配器

适配器把第三方框架调用转换为 Nimi AI 客户端操作。Runtime 仍负责路由与执行，App 负责工具函数和自己的界面或业务状态。

## 区分发布包与源码开发包

| 制品 | 版本与配对 | 本指南的用途 |
| --- | --- | --- |
| npm 已发布的 Vercel 适配器 | 0.1.0；AI SDK 6、provider 3、SDK ^0.13.0 | 历史公开制品，不与当前源码示例混用 |
| 当前工作区 Vercel 适配器源码 | 0.5.0；AI SDK ^7.0.0、provider ^4.0.0、SDK ^0.21.0 | 下方示例使用这一开发组合，通过匹配的本地归档或开发交付包提供 |
| OpenAI-compatible | 仅源码，未作为公共 npm 包分发 | 内部测试与已明确支持的兼容子集 |

公开 0.1.0的声明可在 [npm 制品元数据](https://registry.npmjs.org/@nimiplatform%2fsdk-adapter-vercel-ai/0.1.0)查询。源码包的版本号不表示同版本已经发布。当前App开发环境见[开发环境准备](/zh/start/install)。

## 在当前源码 App 中使用 Vercel AI SDK 7

准备SDK 0.21.0、匹配Kit/Runtime以及源码 adapter 0.5.0的开发归档。复用App已有的宿主绑定client：

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

源码 adapter返回 LanguageModelV4，不能作为AI SDK 6的当前配对。执行还需要该 App 已有的 AIConfig、能力声明与当前有效会话；适配器不提供账户凭据、模型就绪或权限旁路。

## 其他入口

公共AI runner、Runtime和AI工具子路径按各自契约使用。旧 `@nimiplatform/sdk/ai-provider` 已退役，不转发到适配器。

OpenAI-compatible 只提供源码中明确支持的子集；没有发布包，也不能用它直连私人Runtime接口或绕过能力校验。

## Source Basis

- [`sdks/typescript/adapters/vercel-ai/package.json`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/package.json)
- [`sdks/typescript/adapters/vercel-ai/index.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/index.ts)
- [`sdks/typescript/adapters/vercel-ai/README.md`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/README.md)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
