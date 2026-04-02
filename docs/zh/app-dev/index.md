# App 开发者概览

Nimi 为 App 开发者提供了统一的 runtime 和单一的 SDK（`@nimiplatform/sdk`），同时支持本地和云端 AI 模型。只需编写一次集成代码，即可在设备端推理和远程 Provider 之间自由切换，无需修改应用代码。

::: warning 极速开发阶段
Nimi 面向应用的合约已经可用，但仍在快速演进。请跟随当前 SDK 和 runtime spec，优先使用 `createPlatformClient()` 作为高层入口，并且不要把 `spec/future/` 里的 backlog 视为已承诺交付。
:::

## 前置条件

- **Nimi 已安装并运行** -- 使用 `nimi start` 启动 runtime。
- **Node.js**（v18+），SDK 运行所需。

## 快速上手

### 1. 安装 SDK

```bash
npm install @nimiplatform/sdk
```

### 2. 创建 platform client

```ts
import { createPlatformClient } from '@nimiplatform/sdk';

const { runtime } = await createPlatformClient({
  appId: 'docs.app-dev.quickstart',
});
```

### 3. 生成文本

```ts
const result = await runtime.generate({ prompt: 'What is Nimi?' });
console.log(result.text);
```

### 最小可运行示例

```ts
import { createPlatformClient } from '@nimiplatform/sdk';

const { runtime } = await createPlatformClient({
  appId: 'docs.app-dev.minimal',
});
const result = await runtime.generate({ prompt: 'What is Nimi?' });
console.log(result.text);
```

## 后续步骤

- [SDK 安装指南](./sdk-setup.md) -- 安装 SDK 并运行第一个示例
- [App 开发指南](./guide.md) -- 集成模式与项目脚手架
- [实用配方](./recipes.md) -- 可直接运行的构建模块
- [生产环境检查清单](./production-checklist.md) -- 上线前的信心保障
- [SDK 参考文档](../reference/sdk.md) -- API 接口概览
- [错误码参考](../reference/error-codes.md) -- 结构化错误处理
- [Provider 矩阵](../reference/provider-matrix.md) -- 可用 Provider 列表
