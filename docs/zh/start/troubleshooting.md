# Nimi App 接入故障排查

当 Nimi App、SDK 调用、Nimi Lab 验证流程或本地 Runtime 命令执行异常时，可通过本文档进行排查。本指南聚焦于第三方应用开发者在公开接口与常规调试中可直接处理的问题。

## 1. 确认使用的 Runtime 启动方式

源码开发时，在 Nimi 仓库根目录的独立终端运行：

```sh
pnpm dev:runtime
```

随后在另一终端运行 `pnpm dev:desktop`，并在 Nimi Home 完成登录。这个流程使用当前用户的源码 Runtime supervisor；详细准备步骤见 [开发环境准备](/zh/start/install)。

如果排查已安装的 Windows 固定服务，可使用 `nimi status` 查看服务状态；服务已安装且具备控制条件时，使用 `nimi start` 启动。当前 macOS/Linux 没有该后台服务控制器，不能套用这组命令启动源码环境。

`nimi serve` 是生产 daemon 入口；普通 Windows 开发终端会因缺少固定服务身份而被拒绝。需要源码调试时使用上面的 supervisor 流程。

已有 Runtime 环境可运行 `nimi doctor` 检查本地条件，并使用 `nimi health --json` 查看对应服务的健康摘要。

## 2. 检查 App 与桌面端宿主的连接绑定

Nimi App 需使用脚手架生成的 `NimiLocalAppClient` 实例与底层环境通信。如果代码中直接通过通用构造函数创建了独立客户端，可能会因缺失应用身份上下文而收到错误提示。此时应恢复使用脚手架生成的绑定，无需手动硬编码 `appId` 或指定底层 gRPC 地址。

通过 Nimi Home 的开发者模式启动 App，Desktop 提供受保护连接，Runtime 解析当前 App 会话。会话轮换后，应重新调用 `client.agents.listReferences()` 并替换已缓存的 handle；Agent Work 使用 `client.agentWork.listReferences()`。从当前引用列表恢复选择并重新开启所需订阅，不自动重放此前业务动作。传输恢复不会改写 App 自己保存的字符串。

## 3. 配置 Runtime AI 能力意图

当收到 `AI_CONFIG_NOT_FOUND` 错误时，说明当前应用在 Runtime 中尚未配置对应的能力意图（AIConfig）。此时可以在应用的 AI 配置界面中，为当前所需的能力选择具体的执行方式（如本地模型 Local 或云端模型 Cloud），保存后重试即可。

Nimi 采用“能力意图（Capability Intent）”设计模式：应用只需声明所需的能力（如文本生成、向量嵌入），由 Runtime 负责解析和调度具体的提供商与模型路由。当遇到权限不足或执行失败时，请根据 Runtime 返回的明确错误信息调整权限或配置，无需在业务代码中手动拼接降级逻辑。

## 4. Nimi Lab 错误状态说明

Nimi Lab 会针对不同的异常场景提供具体的错误状态，帮助开发者快速定位问题：

| 错误状态 | 产生原因 | 建议操作 |
| --- | --- | --- |
| `runtime-unavailable` | 无法连接到本地 Runtime 服务。 | 确认 Runtime 是否已启动，检查连接端口后重试。 |
| `permission-required` | 当前应用尚未获得对应 AI 能力的授权。 | 检查 App 声明与当前会话/访问摘要，修正覆盖范围或会话条件后通过正式宿主重新启动。 |
| `input-invalid` | 传入的 Prompt 或参数缺失、格式不符合规范。 | 检查并修正输入参数后重新调用。 |
| `sdk-method-unavailable` | 当前应用构建版本未包含该 SDK 方法。 | 升级应用或更新 SDK 依赖至匹配版本。 |
| `runtime-call-failed` | Runtime 执行过程中发生错误。 | 查看终端输出与 Runtime 日志中的详细诊断信息。 |

## 5. 项目脚手架与依赖检查

在通过 App Tools 生成的项目中，可以使用内置命令进行常规健康检查与测试：

```sh
pnpm run check
pnpm run test
```

如果执行 `check` 时提示工具链同步问题，建议先使用锁文件同步依赖，再重新运行检查：

```sh
pnpm install --frozen-lockfile
pnpm run check
```

- **初次初始化**：安装依赖后运行 `pnpm run init` 完成初始设置。
- **配置与依赖刷新**：当更新依赖版本后，运行 `pnpm run sync` 刷新受管配置文件，随后执行 `check` 验证。应用自有的业务代码均会完整保留。
- **提示**：App 项目内的 `pnpm run check` 专注于应用工程本身，与前文用于检查本地 Runtime 服务的 `nimi doctor` 属于不同维度的工具。

## 6. 开发最佳实践与注意事项

- **模块隔离**：建议仅通过 `@nimiplatform/sdk` 和 `@nimiplatform/kit` 公开接口进行开发，避免直接依赖底层内部实现文件。
- **统一路由**：推荐通过 Runtime 统一调度 AI 请求，使应用能够无缝受益于平台内置的密钥保护、本地模型加速与多模型路由能力。
- **解耦模型配置**：避免在业务代码中硬编码具体的模型名称或厂商地址，利用能力意图保持业务的灵活性与可维护性。
- **状态处理**：善用平台返回的明确状态码指导用户操作（如引导授权、提示启动服务），提供更清晰的用户反馈。

## Source Basis

- [`runtime/cmd/nimi/onboarding_helpers.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/cmd/nimi/onboarding_helpers.go)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`sdks/typescript/core/ai/capability-configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/capability-configuration.ts)
- [`sdks/typescript/core/ai/runtime-model.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-model.ts)
- [`apps/lab/src/lab/lab-non-success.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-non-success.ts)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
