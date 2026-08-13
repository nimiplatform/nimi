# 第一次 AI 调用

Runtime-backed AI 请求只携带 App 身份、subject 身份、场景内容和受支持的生成参数。Runtime 在执行开始时读取这个 App 已保存的能力意图，并选择具体实现。

## 前置条件

- `nimi start` 正在运行。
- SDK 能访问 `NIMI_RUNTIME_GRPC_ENDPOINT`，或默认地址 `127.0.0.1:46371`。
- 准确的 App owner 已经为 `text.generate` 保存 AIConfig 能力意图。
- 需要账户身份的调用已经取得 Runtime subject user ID。

Runtime endpoint 变量按层区分：

| 变量 | 读取方 | 用途 |
| --- | --- | --- |
| `NIMI_RUNTIME_GRPC_ENDPOINT` | 本页的显式示例 | App 传入 `runtime.transport.endpoint` 时使用的覆盖值 |
| `NIMI_RUNTIME_ENDPOINT` | Node.js 中 SDK Runtime client 的默认配置 | `createNimiClient` 省略 `runtime.transport` 时使用的 App 侧默认值 |
| `NIMI_RUNTIME_GRPC_ADDR` | Runtime daemon 配置 | daemon 监听地址 |

先运行一次真实 CLI 调用，确认 Runtime 安装可用：

```bash
nimi start
nimi run "What is Nimi?"
```

## 发起文本生成

```ts
import { createNimiClient, textPart } from '@nimiplatform/sdk';

export async function generateText(input: {
  runtimeSubjectUserId: string;
  prompt: string;
}) {
  const client = createNimiClient({
    appId: 'example.sdk.hello',
    runtime: {
      transport: {
        type: 'node-grpc',
        endpoint: process.env.NIMI_RUNTIME_GRPC_ENDPOINT || '127.0.0.1:46371',
      },
    },
  });

  const textGeneration = client.ai.createRuntimeModel({
    subjectUserId: input.runtimeSubjectUserId,
    timeoutMs: 120_000,
  });

  return await textGeneration.generateText({
    messages: [{
      role: 'user',
      content: [textPart(input.prompt)],
    }],
  });
}
```

App 不发送 model、route、connector、target、fallback policy 或实现 binding。响应中的 `modelResolved` 和 route 诊断只记录 Runtime 的执行证据，不能成为下一次请求的输入。

## 能力意图

AIConfig 记录 App owner 对某项能力采用 Local 还是 Cloud 执行平面的意图。负责该配置的服务会在调用前保存意图；App Access 仍是独立的 Runtime admission 事实。生成请求不会将 AIConfig 解析成机器 target，也不会通过请求 metadata 携带 AIConfig。

Local 与 Cloud 意图使用同一种调用形状。Runtime 在执行时评估当前配置和可用条件；无法满足请求时，调用直接以错误结束。

## App 的职责

- 使用拥有能力意图的准确 App 身份。
- 只在操作需要时发送 subject 身份。
- 让 provider credential 留在 Runtime 管理的配置中。
- 处理实际生成调用返回的 typed error。
- 不导入 `runtime/internal/**`，也不直接调用 provider SDK 来替代 Runtime。
- 不增加请求侧 model、route、connector、target、fallback、readiness 或 health 选择。

## 常见 Fail-Closed 状态

| 现象 | 含义 | 修复方向 |
| --- | --- | --- |
| `SDK_CLIENT_APP_ID_REQUIRED` 或 `provide_runtime_ai_app_id` | client 或 operation 缺少 App 身份。 | 给 `createNimiClient` 或 `createRuntimeModel` 传入 `appId`。 |
| `AI_CONFIG_NOT_FOUND` | Runtime 找不到准确 App owner 的 AIConfig。 | 为这个 App 身份保存能力意图。 |
| 能力意图或 App Access 错误 | App 没有 owner 选择的 `text.generate` 意图，或缺少所需 App Access。 | 通过负责 AIConfig 的配置界面设置这项能力，或修正 App Access 声明。 |
| Runtime connection error | daemon 无法通过指定 endpoint 访问。 | 启动 Runtime，并检查 SDK 收到的 endpoint。 |
| dispatch 后出现执行错误 | Runtime 无法选择或运行获准的实现。 | 检查 typed Runtime error 和响应诊断，不要在客户端伪造 fallback。 |

## 验证

在本仓库开发时：

```bash
pnpm --filter @nimiplatform/sdk test
pnpm --filter @nimiplatform/examples check
pnpm --filter @nimiplatform/tester test
```

在 App 仓库中，依次运行 `nimi run`、App 自己的验证命令，再用准确的已配置 App 身份发起一次生成调用。

## 来源依据

- [`sdks/typescript/core/ai/runtime-model.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-model.ts)
- [`sdks/typescript/core/ai/config.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config.ts)
- [`sdks/typescript/runtime/config-projections.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/config-projections.ts)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`apps/tester/src/tester/tester-run-target.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-run-target.ts)
- [`apps/tester/src/tester/tester-runtime.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-runtime.ts)
