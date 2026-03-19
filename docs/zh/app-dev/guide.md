# App 开发指南

如果你正在构建一个使用 Nimi runtime、realm 或两者兼用的第三方应用，请参照本指南。

## 集成模型

- `Runtime` 用于本地 AI 执行（gRPC）
- `Realm` 用于云端状态同步（REST + WebSocket）
- `@nimiplatform/sdk` 是唯一支持的开发者入口
- `nimi-app create`（来自 `@nimiplatform/dev-tools`）是作者侧的脚手架入口

## 推荐流程

1. 从 [SDK 安装指南](./sdk-setup.md) 开始。
2. 使用 `pnpm dlx @nimiplatform/dev-tools nimi-app create --dir my-nimi-app --template basic` 初始化项目。
3. 参考 [`examples/app-template`](https://github.com/nimiplatform/nimi/tree/main/examples/app-template) 作为最小应用模板。
4. 用 `examples/sdk/01-hello.ts` 作为最简基线。
5. 当你需要同时使用本地和云端两种执行平面时，参考 `examples/sdk/03-local-vs-cloud.ts`。
6. 使用 `reasonCode` 和 `traceId` 实现结构化错误处理。

## 一次脚手架

```bash
pnpm dlx @nimiplatform/dev-tools nimi-app create --dir my-nimi-app --template basic
cd my-nimi-app
pnpm install
pnpm start
```

目前可用模板：

- `basic`
- `vercel-ai`

如果你是在 monorepo 内部阅读本文档，且公开包尚未发布，请注意自带模板使用的是已发布的 semver 包名。它们是参考输出结构，暂时还不一定是可自安装的 workspace 包。

## 推荐集成方式

将 runtime 作为操作边界，Provider 密钥集中保存在 runtime 进程中，而非分散到每个应用里。

```ts
import { createPlatformClient } from '@nimiplatform/sdk';

const { runtime } = await createPlatformClient({
  appId: 'docs.app-dev.guide',
});

const result = await runtime.generate({
  prompt: 'What is Nimi?',
});

console.log(result.text);
```

当你需要使用 Provider 默认的云端模型时，添加 `provider: 'gemini'`：

```ts
const result = await runtime.generate({
  provider: 'gemini',
  prompt: 'What is Nimi?',
});
```

如需查看基础脚手架的可跟踪示例，请参考 [`examples/app-template`](https://github.com/nimiplatform/nimi/tree/main/examples/app-template)。如需 Provider 桥接示例，请参考 [`examples/sdk/04-vercel-ai-sdk.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/04-vercel-ai-sdk.ts)。

## 生产环境检查清单

- AI 调用需设置显式超时和回退策略（超出首次运行默认值时）
- 处理 runtime/realm 令牌的生命周期
- 使用 `traceId` 进行错误遥测
- 发布前进行版本兼容性检查

参见 [兼容性矩阵](../reference/compatibility-matrix.md)。
