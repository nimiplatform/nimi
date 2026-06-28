# 第一次 AI 调用

本页说明第三方 App 如何通过公开 SDK 调用 Runtime-backed 文本生成，同时不跨越 Runtime 内部边界。这里有两个不同的检查：

1. Runtime 可以从 CLI 回答一个 prompt。
2. App 可以通过 SDK 携带 live AIConfig `targetRef` 发起 dispatch。

不要跳过第二步。当前 Runtime-backed SDK 调用在缺少 `targetRef` 时会在 scenario dispatch 前 fail closed。

## 前置条件

- `nimi start` 正在运行。
- SDK 能访问 `NIMI_RUNTIME_GRPC_ENDPOINT`，或默认的 `127.0.0.1:46371`。
- 需要用户身份的 route 已经有 Runtime account subject。
- App 已经有要运行能力的 AIConfig binding。文本生成通常绑定到 `text.generate`。

Runtime endpoint 变量按层区分：

| 变量 | 读取方 | 用途 |
| --- | --- | --- |
| `NIMI_RUNTIME_GRPC_ENDPOINT` | 本页下面的显式示例 | 当 App 自己传入 `runtime.transport.endpoint` 时使用的覆盖值 |
| `NIMI_RUNTIME_ENDPOINT` | Node.js 中 SDK Runtime client 的默认值 | `createNimiClient` 省略 `runtime.transport` 时的 App 侧默认 endpoint |
| `NIMI_RUNTIME_GRPC_ADDR` | Runtime daemon config | daemon 监听地址 |

先确认 Runtime readiness：

```bash
nimi start
nimi run "What is Nimi?"
```

如果这个命令失败，先修 Runtime 配置，不要先调试 App 代码。

## 必需的 Binding

Runtime-backed SDK dispatch 需要 live `NimiAIConfigTargetRef`。

| Target kind | 必填字段 | 来源 |
| --- | --- | --- |
| `local-runtime` | `version: 'v2'`，并且 `profileBindingId` / `readinessRef` 二选一 | Runtime local model readiness、Kit Model Config 或 App AIConfig service |
| `cloud-connector` | `connectorId`、`remoteModelCatalogId`、`providerModelId` | Runtime provider connector inventory 或已应用的 AI profile |

`profile-slice` 不是 live Runtime target。先 materialize/apply profile，再 dispatch。

## 从 AIConfig 发起 Dispatch

这是 App shell 或 model-config surface 已经加载 App `NimiAIConfig` 后应该使用的 SDK 形状。

```ts
import {
  createNimiClient,
  resolveNimiAIConfigRuntimeBinding,
  textPart,
  type NimiAIConfig,
} from '@nimiplatform/sdk';

export async function generateWithAppAIConfig(input: {
  aiConfig: NimiAIConfig;
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

  const resolved = resolveNimiAIConfigRuntimeBinding({
    config: input.aiConfig,
    capabilityId: 'text.generate',
    bindingCapabilityId: 'text.generate',
  });
  if (resolved.ok === false) {
    throw new Error(resolved.message);
  }

  const binding = resolved.binding;
  const model = client.ai.createRuntimeModel({
    model: {
      modelId: binding.model,
      ...(binding.connectorId ? { providerId: binding.connectorId } : {}),
    },
    routePolicy: binding.routePolicy,
    connectorId: binding.connectorId,
    subjectUserId: input.runtimeSubjectUserId,
    timeoutMs: 120_000,
    targetRef: binding.targetRef,
    metadata: binding.metadata,
  });

  return await model.generateText({
    model: model.model,
    messages: [{
      role: 'user',
      content: [textPart(input.prompt)],
    }],
  });
}
```

失败分支还包含 typed `reason` 字段。`message` 适合展示给人或直接抛错；当 App 需要按 `target-ref-missing`、`binding-capability-missing` 或其他 fail-closed 状态分支处理时，使用 `reason`。

App 负责从自己的 AIConfig service 加载 `aiConfig`。在生成的 Nimi App scaffold 和 `apps/tester/` 中，Kit model-config surface 负责让开发者选择或应用 Runtime model binding 的 UI 流程。

## 直接 TargetRef 调用

只有当 App 已经从 Runtime inventory、model-config 或已应用的 AI profile 得到 live target ref 时，才应该直接调用：

```ts
const model = client.ai.createRuntimeModel({
  model: { modelId: binding.model },
  routePolicy: binding.routePolicy,
  subjectUserId: runtimeSubjectUserId,
  targetRef: binding.targetRef,
});
```

不要在产品代码中编造 target ref。target ref 是 Runtime 能路由到所选本地模型或云 connector 的证据。

## App 不应该做什么

- 不要导入 `runtime/internal/**`。
- 不要把直接调用 provider SDK 当成 Nimi Runtime 的替代。
- 不要在用户或 Runtime 配置面之外硬编码 provider 或 model 默认值。
- 不要在没有 live `targetRef` 的情况下调用 `createRuntimeModel`。
- 不要把 CLI 成功当成 App 已经有 AIConfig binding 的证明。

## 常见 Fail-Closed 状态

| 现象 | 含义 | 修复方向 |
| --- | --- | --- |
| `SDK_CLIENT_APP_ID_REQUIRED` 或 `provide_runtime_ai_app_id` | client 或 operation 没有提供 app identity。 | 给 `createNimiClient` 或 `createRuntimeModel` 传入 `appId`。 |
| `resolve_runtime_target_ref_before_invocation` | SDK dispatch 没有收到 live target ref。 | 在 `createRuntimeModel` dispatch 前解析 App AIConfig binding。 |
| `profile-slice-unmaterialized` | AIConfig 仍然指向 profile slice，不是 live Runtime target。 | 通过 App 的 model-config flow apply/materialize profile。 |
| Runtime connection error | daemon 在配置的 gRPC endpoint 不可达。 | 启动 Runtime，并确认传给 `runtime.transport.endpoint` 的 endpoint；如果省略 transport，则确认 `NIMI_RUNTIME_ENDPOINT`。 |
| local route 没有 ready model | Runtime 无法解析所选 local runtime target。 | 安装或选择本地文本模型，然后用 `nimi run` 验证。 |
| cloud route 没有 provider | Runtime 没有配置请求的 provider connector。 | 先在 Runtime 中配置 provider，再使用 cloud connector target。 |

## 验证

在本仓库开发时，保持相关 SDK 与 scaffold 检查通过：

```bash
pnpm --filter @nimiplatform/sdk test
pnpm --filter @nimiplatform/app-tools test
pnpm --filter @nimiplatform/tester test
```

在 App 仓库里，按这个顺序验证：

```bash
nimi run "What is Nimi?"
pnpm run validate
pnpm run doctor
```

然后运行一条 App 自己的生成路径，确认它加载 AIConfig 并携带 `targetRef` dispatch。

## 来源依据

- [`sdks/typescript/core/ai/runtime-model.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-model.ts)
- [`sdks/typescript/core/ai/runtime-target-ref.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-target-ref.ts)
- [`sdks/typescript/core/ai/config-runtime-binding.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config-runtime-binding.ts)
- [`sdks/typescript/runtime/index.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/index.ts)
- [`runtime/internal/config/load.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/config/load.go)
- [`runtime/internal/config/types.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/config/types.go)
- [`apps/tester/src/tester/tester-runtime-invokers-core.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-runtime-invokers-core.ts)
- [`apps/tester/test/tester-contract/runtime-invokers.mjs`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/test/tester-contract/runtime-invokers.mjs)
