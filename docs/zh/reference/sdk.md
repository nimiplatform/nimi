# SDK 参考

`@nimiplatform/sdk` 是 runtime 和 realm 集成的统一入口。

## 公共接口

- `@nimiplatform/sdk`
- `@nimiplatform/sdk/runtime`
- `@nimiplatform/sdk/realm`
- `@nimiplatform/sdk/types`
- `@nimiplatform/sdk/ai-provider`
- `@nimiplatform/sdk/mod/*`

## 基本用法

```ts
import { createPlatformClient } from '@nimiplatform/sdk';

const { runtime } = await createPlatformClient({
  appId: 'docs.sdk.reference',
});

const result = await runtime.generate({
  prompt: 'What is Nimi?',
});
```

`createPlatformClient()` 是 app 和示例的推荐入口。在 Node.js 环境里，它可以直接走本地 daemon 的 runtime 默认配置，同时从同一个 SDK 根入口暴露 typed Realm 能力。只有在你确实需要显式低层控制时，才直接使用 `@nimiplatform/sdk/runtime` 或 `@nimiplatform/sdk/realm`。

指定 Provider 的云端调用：

```ts
const result = await runtime.generate({
  provider: 'gemini',
  prompt: 'What is Nimi?',
});
```

高层便捷接口将 `model` 视为本地或 Provider 范围内的模型 ID。完全限定的远程模型 ID 请使用底层接口 `runtime.ai.text.generate(...)`。

## 源码参考

- SDK 实现指南：[`sdk/README.md`](https://github.com/nimiplatform/nimi/blob/main/sdk/README.md)
- SDK 规范索引：[`spec/sdk`](https://github.com/nimiplatform/nimi/blob/main/spec/sdk/index.md)
- SDK 内核表/文档：[`spec/sdk/kernel`](https://github.com/nimiplatform/nimi/blob/main/spec/sdk/kernel/index.md)
