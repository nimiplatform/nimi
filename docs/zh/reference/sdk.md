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
import { Runtime } from '@nimiplatform/sdk/runtime';

const runtime = new Runtime();

const result = await runtime.generate({
  prompt: 'What is Nimi?',
});
```

Node.js 用户可以使用 `new Runtime()` 连接本地 daemon 默认配置。如果在非 Node.js 环境中运行，或需要连接非默认端点，请使用显式 transport。

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
