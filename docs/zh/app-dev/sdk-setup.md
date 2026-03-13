# SDK 安装指南

## 安装 SDK

```bash
npm install @nimiplatform/sdk
```

## 首次本地生成

创建一个文件（例如 `hello.ts`），然后使用 `npx tsx hello.ts` 运行：

```ts
import { Runtime } from '@nimiplatform/sdk/runtime';

const runtime = new Runtime();
const result = await runtime.generate({
  prompt: 'Explain Nimi in one sentence.',
});
console.log(result.text);
```

这段代码调用本地 runtime，无需 API 密钥，无需网络连接 -- 模型完全在你的设备上运行。

## 切换到云端

保持相同的代码结构，添加 `provider` 字段即可：

```ts
const result = await runtime.generate({
  provider: 'gemini',
  prompt: 'Explain Nimi in one sentence.',
});
```

SDK 会自动处理认证和路由。通过 `nimi provider set` 或环境变量配置 Provider 密钥。

![Nimi SDK 演示](../../assets/nimi-sdk.gif)

## 示例阶梯

按顺序运行自带示例，逐步探索更高级的模式：

```bash
npx tsx examples/sdk/01-hello.ts
npx tsx examples/sdk/02-streaming.ts
npx tsx examples/sdk/03-local-vs-cloud.ts
npx tsx examples/sdk/04-vercel-ai-sdk.ts
```

## 后续步骤

- [App 开发指南](./guide.md) -- 集成模式与项目脚手架
- [实用配方](./recipes.md) -- 可直接运行的构建模块
