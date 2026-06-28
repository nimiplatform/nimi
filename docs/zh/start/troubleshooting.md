# Nimi App 接入故障排查

当 Nimi App、SDK 调用、Tester lane 或本地 Runtime 命令在生成完成前失败时，先看这页。这里聚焦第三方 App 作者能通过公开表面处理的问题。

## 先检查 Runtime

运行：

```sh
nimi doctor
```

如果 daemon 不可达，Runtime 会给出与 CLI 首次运行路径一致的下一步：

```sh
nimi start
```

需要前台运行 daemon 时使用：

```sh
nimi serve
```

随后验证零配置路径：

```sh
nimi run "What is Nimi?"
```

如果要走云 provider，先配置 provider 再调用：

```sh
nimi provider set gemini --api-key-env GEMINI_API_KEY
nimi run "What is Nimi?" --provider gemini
```

## SDK Client 配置

`SDK_CLIENT_APP_ID_REQUIRED` 表示这次 SDK 操作需要具体 app id。创建 root client 时传入 `appId`，或在需要它的 Runtime AI surface 中显式传入 `appId`：

```ts
import { createNimiClient } from '@nimiplatform/sdk';

const nimi = createNimiClient({
  appId: 'my-nimi-app',
  runtime: {
    transport: {
      type: 'node-grpc',
      endpoint: process.env.NIMI_RUNTIME_GRPC_ENDPOINT || '127.0.0.1:46371',
    },
  },
});
```

SDK 会在 dispatch 前失败。不要通过 App 代码直接调用 Runtime 私有端点来绕过这个错误。

## Runtime AI Target Resolution

`resolve_runtime_target_ref_before_invocation` 表示 App 在没有 live Runtime target reference 的情况下发起了 Runtime-backed AI 调用。应先加载 App 的 AIConfig，解析 binding，再把 `binding.targetRef` 传给 Runtime AI model 或 runner。

SDK helper 是：

```ts
import { resolveNimiAIConfigRuntimeBinding } from '@nimiplatform/sdk';
```

如果 `resolveNimiAIConfigRuntimeBinding(...)` 返回 `profile-slice-unmaterialized`，说明配置仍指向 profile slice。需要通过 model configuration surface 把 profile apply/materialize 成 live `local-runtime` 或 `cloud-connector` target 后再 dispatch。

如果返回 `target-ref-missing`，或 Runtime/Tester 表面显示 `ai-config-binding-missing`，说明该 capability 没有已选择的 model binding。请在 Kit model-config UI 中选择模型，或向 App AIConfig store 写入有效的 `targetRefs[capabilityId]`。

## Tester Unavailable Reasons

Tester 会显示 typed unavailable state，而不是把所有失败都归为 SDK method 缺失。

| Reason | 含义 | 处理 |
| --- | --- | --- |
| `runtime-not-ready` | Runtime 还不可达。 | 启动或重新连接 Runtime 后重试。 |
| `ai-config-binding-missing` | capability 没有 model binding。 | 在 model control 里选择模型，或 apply 一个 AIProfile。 |
| `input-invalid` | prompt 或 capability 输入缺失/格式错误。 | 修正输入后重新运行。 |
| `auth-context-missing` | 该 route 需要已登录的 Nimi account。 | 通过 Runtime-backed shell 登录，或改用 local model binding。 |
| `principal-unauthorized` | Runtime account session 过期或未授权。 | 重新登录后重试。 |
| `sdk-method-unavailable` | 当前 App build 没有暴露该 capability。 | 更新 App，或改用已准入的 SDK capability。 |
| `local-environment-preparing` | Runtime 正在准备本地 image 依赖。 | 保持 Runtime 运行，等待 setup ready 后重试。 |
| `local-environment-blocked` | 缺少必需的本地 image companion models。 | 先选择必需 companion models 再重试。 |
| `runtime-call-failed` | Runtime 返回 typed contract failure。 | 查看 Runtime 原始错误和已选择模型。 |
| `tauri-command-failed` | 桌面 shell 未能完成命令。 | 重新打开 shell，或等待 shell readiness 恢复后重试。 |

## App Scaffold Checks

使用 `@nimiplatform/app-tools` 创建的 App 应运行生成项目里的脚本：

```sh
pnpm run init
pnpm run doctor
pnpm run test
pnpm run check
```

`pnpm run doctor` 会检查 scaffold init/lock state、managed glue、package-owned projections、dependency alignment 以及 forbidden shortcut patterns。doctor 失败是 scaffold contract failure；`pnpm run update` 只用于刷新 scaffold-managed files，App-owned product code 应保持分离。

## 不要直接复制的做法

- 不要在外部 App 中导入 `runtime/internal/**` 或 `apps/**` 实现文件。
- 不要用 app-local REST 绕过 Runtime 来执行 AI。
- 不要在 app-owned product code 中硬编码 provider/model 标识。
- 不要把 Tester unavailable reason 当作成功状态。它就是可行动的失败状态。

## 来源依据

- [`runtime/cmd/nimi/onboarding_helpers.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/cmd/nimi/onboarding_helpers.go)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`sdks/typescript/core/ai/runtime-target-ref.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-target-ref.ts)
- [`sdks/typescript/core/ai/config-runtime-binding.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config-runtime-binding.ts)
- [`apps/tester/src/tester/tester-unavailable.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-unavailable.ts)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
