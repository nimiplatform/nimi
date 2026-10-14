# 常见问题与故障排查

在开发 Nimi App、调用 SDK、运行 Nimi Lab 测试或启动本地 Runtime 时遇到异常？本文整理了最常见的接入问题、原因分析与排查步骤。

---

## 1. 确认 Runtime 的启动模式

请根据当前的运行环境，选择对应的 Runtime 启动方式：

### 源码开发环境（推荐）
在 Nimi 仓库根目录下打开终端并执行：
```bash
pnpm dev:runtime
```
接着在第二个终端运行 `pnpm dev:desktop` 并登录 Nimi Home。这是源码开发与联调阶段推荐的双进程托管流程。

### Windows 系统服务
如果你安装了 Nimi 官方桌面客户端并注册了 Windows 后台服务，可通过以下命令管理：
- `nimi status`：查看服务运行状态。
- `nimi start`：启动后台服务。
- `nimi doctor`：运行本地环境体检。
- `nimi health --json`：获取结构化的服务健康指标摘要。

> [!NOTE] 启动注意事项
> `nimi serve` 仅供后台守护进程（daemon）调用，在普通开发终端中直接运行会被系统拒绝；源码开发请使用 `pnpm dev:runtime`。日常运行请使用对应平台受支持的启动器（目前应用包生命周期仅支持 macOS arm64 与 Windows x86_64）。

---

## 2. 检查 App 与桌面宿主的会话绑定

Nimi App 必须通过脚手架生成的宿主绑定客户端与底层 Runtime 通信：

```ts
import { getNimiLocalAppClient } from './shell/auth/local-app-client';
const client = getNimiLocalAppClient();
```

- **避免手动直连**：不要在 App 内调用 `createNimiClient({ appId, ... })` 手动传入 gRPC 地址或凭证。App 渲染层必须复用受保护的宿主会话；自行创建的直连客户端无法获取该 App 的受保护访问权限（具体报错取决于被拒绝的操作类型）。
- **妥善处理会话轮换**：当用户切换账号或重建会话后，应停止旧任务并丢弃已失效的句柄，再基于新会话重新读取状态和建立订阅。仅刷新列表本身不会将正在运行的任务重新绑定到新会话。

---

## 3. 解决 `AI_CONFIG_NOT_FOUND` 错误

如果发起 AI 推理请求时收到 `AI_CONFIG_NOT_FOUND` 或 `ai-config-not-found` 错误：

### 原因
当前应用尚未在本地 Runtime 中保存对应能力（如 `text.generate`）的路由配置。

### 解决方法
1. 打开应用的 **AI 设置面板**（或在 Nimi Home 中打开该应用的设置项）。
2. 为所需能力选择执行策略：
   - **Local（本地模型）**：选择 Nimi 中已为该能力选定并就绪的本地模型资源。
   - **Cloud（云端模型）**：选择已配置有效 API Key 的云端服务商连接器（如 OpenAI、Anthropic 等）。
3. 保存配置后重新发起请求。

> [!TIP] 能力意图设计
> Nimi 采用“能力意图（Capability Intent）”模式：App 只需声明需要什么能力（如生成文本、计算向量），由 Runtime 根据用户配置将请求派发到目标模型。业务代码无需硬编码模型名称或服务商地址，用户始终掌握算力与密钥的路由选择权。

---

## 4. Nimi Lab 错误状态速查表

在 Nimi Lab 中测试和验证能力时，常见错误状态的含义与处理方式如下：

| 错误状态 | 产生原因 | 推荐解决步骤 |
| :--- | :--- | :--- |
| `runtime-unavailable` | 无法连接到本地 Runtime 服务。 | 检查 `pnpm dev:runtime` 是否正在运行，并确认本地服务端口通信正常。 |
| `principal-unauthorized` | 当前会话或调用主体未获准执行该操作。 | 检查 Nimi Home 的登录与该应用的 Nimi Access 状态，并核对 `nimi.app.yaml` 中所需的访问声明；AI 调用需要 `runtime.consume`。 |
| `input-invalid` | 传入的 Prompt、消息体或参数格式不合法。 | 检查调用传参，确保 messages 结构完整且包含必需字段。 |
| `sdk-method-unavailable` | 当前安装的 SDK 版本未导出或不支持该方法。 | 检查 `package.json` 中的 `@nimiplatform/sdk` 版本，升级至匹配的发布版本。 |
| `runtime-call-failed` | Runtime 执行过程中遇到底层模型异常或网络中断。 | 查看 Runtime 终端日志或 Nimi Desktop 控制台，获取详细错误堆栈。 |

---

## 5. 项目工程健康检查

在 App 工程根目录下，可使用内置脚本检查项目状态：

```bash
# 校验项目声明与受管配置
pnpm run check

# 运行自动化测试
pnpm run test
```

如果更新依赖或切换 Git 分支后出现配置不同步的提示，可按顺序执行：

```bash
# 严格按照锁文件同步依赖
pnpm install --frozen-lockfile

# 刷新受管配置文件（保留你的业务代码）
pnpm run sync

# 再次校验项目健康度
pnpm run check
```

---

## 6. 开发者最佳实践

1. **复用单一宿主客户端**：始终使用脚手架生成的 `getNimiLocalAppClient()`，不要重复创建客户端实例。
2. **面向能力意图编程**：通过能力意图请求 AI 服务，不在业务代码中硬编码模型名称或远端地址。
3. **提供清晰的状态反馈**：在界面上明确区分“等待推理”、“服务未连接”与“访问未就绪”等状态，并提供直达设置页的操作入口。

## Source Basis

- [`runtime/cmd/nimi/onboarding_helpers.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/cmd/nimi/onboarding_helpers.go)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`apps/lab/src/lab/lab-non-success.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-non-success.ts)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
