# Nimi 开发者首日入门指南 (Onboarding)

欢迎加入 Nimi 仓库！这篇文档的目标是帮助你在第一天顺畅走通本地开发环境，并快速达成以下里程碑：

1. **环境就绪**：安装好所需的基础工具链。
2. **本地 Runtime 运行中**：本地 AI 服务守护进程启动成功并通过健康检查。
3. **前端工作台跑通**：至少成功启动 `desktop` 或 `web` 的本地开发界面。
4. **掌握基本准则**：了解 monorepo 边界划分、核心命令与协作流程。

---

## 1. 核心架构与代码目录

Nimi 是一个多组件组成的 Monorepo，核心目录划分如下：

### 基础与核心服务

| 模块 | 目录 | 语言 / 框架 | 职责 |
|---|---|---|---|
| **Runtime** | `runtime/` | Go | 本地核心守护进程 (Daemon) 与 CLI，负责模型调度与受保护 App 访问 |
| **SDK** | `sdks/typescript/` | TypeScript | 面向生态应用的统一开发接口 (`@nimiplatform/sdk`) |
| **Kit** | `kit/` | TypeScript + React | 跨 App 共享工具包：基础 UI 组件、身份认证、监控与 Feature 模块 |
| **Proto** | `proto/` | Protocol Buffers | 核心 gRPC 通信协议契约 |
| **Authority** | `.nimi/spec/` | YAML + Markdown | 平台产品权威规范 (Canonical Authority) |
| **Docs** | `docs/` | VitePress | 官方开发者文档站点 |

### 官方应用与宿主

| 应用 | 目录 | 技术栈 | 说明 |
|---|---|---|---|
| **Desktop** | `apps/desktop/` | Electron + React | 主桌面宿主 (Nimi Home)，整合 Agent 对话、应用工作区与本地 AI 管理 |
| **Avatar** | `apps/avatar/` | Electron + React | 桌面浮动角色具身载体，由 Desktop 联动唤起 |
| **Web** | `apps/web/` | React | 官方展示站与 Web 登录入口 |
| **Install Gateway** | `apps/install-gateway/` | Cloudflare Worker | 跨平台安装包分发网关 |

---

## 2. 准备工具链

请先确保你的开发机器已安装以下工具：

- **Node.js**：`>= 24.22.1 < 25`（Node 24 LTS 分支）
- **pnpm**：`10.34.7`（与根目录 `packageManager` 保持一致）
- **Go**：`>= 1.26.10`（编译和调试 Runtime 必备，具体版本以 `runtime/go.mod` 为准）
- **Git**

*可选工具（按需安装）：*
- **Rust toolchain**：涉及 Kit 原生组件、Desktop 原生底层包或 Tauri 实验宿主时需要。
- **Buf CLI**：修改 `proto/` 协议并重新生成代码时使用。

快速验证版本：
```bash
go version
node -v
pnpm -v
```

---

## 3. 首次配置与安装依赖

以下配置用于源码联调，不是使用测试安装包的前置条件。体验现有测试版本请从[下载页](https://nimi.ai/download)选择对应平台。

源码联调的 `pnpm dev:runtime` 启动器固定连接 `http://127.0.0.1:3002` 的 Realm，需要预先具备允许当前开发客户端接入的本地联调服务。公开仓库不包含 Realm 服务端实现；安装本仓库依赖不会启动 Realm。缺少该服务时，账号全链路联调尚不可用，可先使用测试安装包体验产品。

### 步骤 1：创建 `.env`
在仓库根目录新建 `.env`（可参考 `.env.example`）。以下本地地址仅适用于相应服务已配置并运行的联调环境；修改环境变量不会改变源码 Runtime 启动器的固定 Realm 地址：

```bash
# nimi/.env
NIMI_RUNTIME_BRIDGE_MODE=RUNTIME
NIMI_REALM_URL=http://127.0.0.1:3002
NIMI_CONTROL_PLANE_URL=http://localhost:46372
NIMI_WEB_URL=http://localhost:3000
```

> **参数说明**：
> - `NIMI_RUNTIME_BRIDGE_MODE`：本地源码联调请固定使用 `RUNTIME`（发布测试使用 `RELEASE`）。
> - `NIMI_REALM_URL`：本地联调 Realm 地址；这里的 `127.0.0.1:3002` 不是本仓库提供或自动启动的服务。
> - `NIMI_CONTROL_PLANE_URL`：本地 Runtime 控制面 HTTP 监听地址（默认端口 `46372`）。
> - `NIMI_WEB_URL`：面向 Web 功能的基础地址（注：Desktop 登录 URL 与一次性回环回调由 Runtime 签发，不从此变量拼接）。
> - *提示：请勿将包含私有配置或密钥的 `.env` 提交到 Git。*

### 步骤 2：安装依赖与初始编译
在仓库根目录执行：

```bash
# 安装所有 workspace 依赖
pnpm install

# 编译各组件（可选快速检查）
pnpm build
```

---

## 4. 启动与验证本地 Runtime

Runtime 是支撑本地 AI 任务与受保护 App 调用的核心引擎。

### 步骤 1：启动本地 Runtime
启动本地 Runtime 无需预先配置云端 API 密钥，直接运行：

```bash
pnpm dev:runtime
```

该命令会在前台启动源码模式的 Runtime supervisor 并持续输出日志。

> **联调前置条件**：
> - **本地 Realm 服务**：当前源码启动器固定连接 `http://127.0.0.1:3002` 的本地 Realm，需另行准备可用的 Realm 服务才能完成账号登录。
> - **首次数据目录初始化**：首次使用时需在 Nimi Home 中选择数据存储位置；若遇到「未完成设置」提示，在客户端完成设置后重试即可。

### 步骤 2：检查健康状态
新开一个终端窗口，运行健康检查命令：

```bash
pnpm runtime:health
```

如果输出健康状态（`ok` 或 `serving`），说明 Runtime 已正常监听在默认端口：
- **gRPC 服务**：`127.0.0.1:46371`
- **HTTP 控制面**：`127.0.0.1:46372`

**（可选）配置云端模型连接器**：
如需调用 Gemini 或 OpenAI 等云端模型，可在启动 Desktop 客户端后，在 Nimi Home 的「云服务」中添加对应的 Connector，再为所需能力选择模型。标准 App 通过受保护会话调用模型能力，不会直接接管云端凭据。

---

## 5. 启动桌面客户端 (Nimi Desktop)

在保持 Runtime 运行的前提下，新开终端启动主桌面客户端：

```bash
pnpm dev:desktop
```

启动后：
1. 客户端首次运行会引导选择数据存储目录（存储于 `~/.nimi/nimi.json` 中的 `dataRoot.path`）。
2. 在浏览器弹出的页面中完成 Nimi 账号登录授权。
3. 登录后即可在 Nimi Home 中体验角色对话、本地模型管理与内置应用。

### 启动 Desktop 监督的生态应用
在 Desktop 保持运行并处于登录状态时，你可以在根目录下直接启动受其监管的生态应用：

```bash
pnpm dev:lab       # Nimi Lab 能力测试台
pnpm dev:zhiyu     # 织羽 (Zhiyu) AI 伙伴
pnpm dev:nimigo    # NimiGo
pnpm dev:nimiday   # NimiDay
```

*注意：`pnpm dev:avatar` 用于启动独立的桌面 Avatar 浮动窗口，与普通的 `pnpm dev:desktop` 互斥。*

---

## 6. Web 端开发

如需调试基于浏览器的官网与 Web 页面：

```bash
pnpm --filter @nimiplatform/web dev
```

浏览器打开 `http://127.0.0.1:3000` 即可实时预览。

---

## 7. 在第三方 App 中使用 SDK

生态应用在 Desktop 监管的宿主中运行时，直接通过标准 Bridge 注入的 Client 即可发起调用：

```ts
import { createNimiClient, type NimiLocalAppClient } from '@nimiplatform/sdk';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

// 创建受管 App 专属 Client（无需手动传递 Token、App ID 或 RPC 端口）
const client: NimiLocalAppClient = createNimiClient({
  localApp: { standardShell: createNimiLocalAppStandardShellSurface() },
});

// 发起一次文本生成
const response = await client.ai.text.generateCandidate({
  messages: [{ role: 'user', text: '你好，请帮我列出今天的三项核心待办。' }],
});
console.log(response.text);
```

使用 `@nimiplatform/app-tools` 脚手架新建的项目已经为你配置好了这套机制。

---

## 8. 日常高频开发命令

```bash
# 全局代码检查与单元测试
pnpm lint
pnpm test

# 针对特定包进行迭代
pnpm --filter @nimiplatform/sdk test
pnpm --filter @nimiplatform/kit test
pnpm --filter @nimiplatform/desktop typecheck

# 协议重新生成
pnpm proto:generate
pnpm proto:lint

# 权威规范一致性校验
pnpm spec:authority:check
```

---

## 9. 核心架构约束与开发准则

为了保持代码库的健康与安全，请时刻谨记以下几条底线：

1. **分层依赖清晰**：
   - `desktop` 与 `web` **严禁** 直接导入 `runtime/internal/*`。
   - `sdks` 不得与 Realm 或 Runtime 的私有内部逻辑耦合。
2. **凭据零泄露**：
   - 前端 UI 与 App 渲染进程不持有底层系统凭据或长效 Token，所有受控操作通过 Runtime 授权中继。
3. **以 Spec 为产品权威**：
   - 产品的行为语义与状态机定义以 `.nimi/spec/**` 为准。在改动跨域核心契约前，先明确规范归属。
4. **先就近阅读规范**：
   - 深入改动某一模块前，先查阅对应目录下的 `AGENTS.md`。

---

## 10. 遇到问题？常见排查思路

### Q1：修改了 Runtime 配置但似乎没有生效？
Runtime 目前以守护进程方式运行，配置更新后需要重启 Runtime 进程以使新配置生效。

### Q2：调用 AI 接口报凭据或连接错误？
1. 检查本地 Runtime 是否正常运行（`pnpm runtime:health`）。
2. 在 Nimi Home 的「云服务」中确认已添加对应的 Connector，且该模型提供商处于正常可用状态。
3. 如果调用的是本地模型，请在 Nimi 的 AI 能力设置中确认对应的本地运行方案与依赖已经就绪。

### Q3：想使用统一的 Runtime CLI 调试底层？
可以使用根目录提供的命令透传工具：
```bash
pnpm runtime:cmd -- health --json
pnpm runtime:cmd -- doctor --json
```

祝你开发愉快！如果遇到未涵盖的问题，欢迎在 Discord 或 GitHub Issue 中与团队交流。
