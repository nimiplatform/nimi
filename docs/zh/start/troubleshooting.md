# Nimi App 接入故障排查

当 Nimi App、SDK 调用、Nimi Lab lane 或本地 Runtime 命令在生成完成前失败时，先看这页。这里聚焦第三方 App 作者能通过公开表面处理的问题。

## 先检查 Runtime

运行：

```sh
nimi doctor
```

在具有已准入后台/服务控制器的构建中，daemon 停止时会给出受限的后台启动提示：

```sh
nimi start
```

源码开发或没有该后台拓扑的构建应以前台方式运行：

```sh
nimi serve
```

已准入后台管理时，可验证其脱敏后的 manager 摘要：

```sh
nimi health --json
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

## Runtime AI 能力意图

`AI_CONFIG_NOT_FOUND` 表示 Runtime 找不到本次调用所用准确 App owner 的 AIConfig。请通过负责 AIConfig 的配置界面，为所需 capability 保存 Local 或 Cloud 意图，然后用相同请求重试。

能力意图不会解析成请求侧 model、route、connector、target reference 或 fallback。实际调用返回 authorization、feature support 或 execution error 时，保留 typed Runtime failure 和诊断信息；不要在 App 代码中拼出另一个 target。

## Nimi Lab Unavailable Reasons

Nimi Lab 会显示 typed unavailable state，而不是把所有失败都归为 SDK method 缺失。

| Reason | 含义 | 处理 |
| --- | --- | --- |
| `runtime-unavailable` | Runtime 无法处理这次请求。 | 启动或重新连接 Runtime 后重试。 |
| `permission-required` | 文本生成权限尚未获准。 | 在 Nimi Desktop 中批准或恢复权限，然后重试。 |
| `input-invalid` | prompt 或 capability 输入缺失或格式错误。 | 修正输入后重新运行。 |
| `sdk-method-unavailable` | 当前 App build 没有暴露该 capability。 | 更新 App，或改用已准入的 SDK capability。 |
| `runtime-call-failed` | Runtime 返回 typed contract failure。 | 查看 Runtime 原始错误和诊断信息。 |

## App 项目检查

使用 App Tools 生成项目中的现有命令检查：

```sh
pnpm run check
pnpm run test
```

切换代码或修改依赖后，如果 `check` 报告 nimicoding 同步失败，先用 `pnpm install --frozen-lockfile` 恢复项目锁定的依赖，再重跑同一检查。实际安装的 CLI 版本过旧时，也会报告文件漂移，不应先把受管文件改成旧包要求的版本。

首次安装依赖后先运行 `pnpm run init`。需要刷新脚手架管理的文件或依赖时，运行 `pnpm run sync`，再执行 `check`；App 自己的产品代码会保留。旧的 `pnpm run doctor`、`pnpm run update` 和 `local-audit` 不在当前生成 scripts 中。这里的 App 项目命令与上文 Runtime 的 `nimi doctor` 是不同的工具入口。

## 脚手架边界

- 不要在外部 App 中导入 `runtime/internal/**` 或 `apps/**` 实现文件。
- 不要用 app-local REST 绕过 Runtime 来执行 AI。
- 不要在 app-owned product code 中硬编码 provider/model 标识。
- 不要把 Nimi Lab unavailable reason 当作成功状态。它就是可行动的失败状态。

## 来源依据

- [`runtime/cmd/nimi/onboarding_helpers.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/cmd/nimi/onboarding_helpers.go)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`sdks/typescript/core/ai/capability-configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/capability-configuration.ts)
- [`sdks/typescript/core/ai/runtime-model.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-model.ts)
- [`apps/lab/src/lab/lab-non-success.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-non-success.ts)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
