# Nimi Onboarding

本指南面向首次加入 `nimi` 仓库的开发者，目标是让你在第一天完成以下结果：

1. 本地环境安装完成。
2. `runtime` 可启动并返回健康状态。
3. `sdk`、`desktop`、`web` 至少一个开发面可运行。
4. 了解最基本的仓库边界、质量门禁和提交流程。

## 1. 仓库与组件

`nimi` 是一个多组件 monorepo，组件如下：

### 核心基础

| 组件 | 目录 | 语言 | 说明 |
|---|---|---|---|
| runtime | `runtime/` | Go | 本地 AI daemon 和 CLI |
| sdk | `sdks/typescript/` | TypeScript | 统一 SDK (`@nimiplatform/sdk`) |
| kit | `kit/` | TypeScript + React | 跨 app 工具包：设计系统、auth、telemetry、feature 模块 |
| proto | `proto/` | Protocol Buffers | gRPC 协议定义 |
| spec | `.nimi/spec/` | YAML + Markdown | 产品权威（canonical authority） |
| docs | `docs/` | VitePress | 开发者文档站点 |

### 应用（Apps）

| 应用 | 目录 | 技术栈 | 说明 |
|---|---|---|---|
| desktop | `apps/desktop/` | Electron + React | 主桌面 host、agent 交互、本地 AI |
| avatar | `apps/avatar/` | Electron + React | 由 Desktop 交接启动的桌面 Avatar 悬浮 carrier |
| web | `apps/web/` | React | 浏览器客户端（Cloudflare Pages） |
| install-gateway | `apps/install-gateway/` | Cloudflare Worker | 发行分发网关 |

### 扩展

| 组件 | 目录 | 说明 |
|---|---|---|
| kit shell tauri | `kit/shell/tauri/` | Tauri 宿主共享的 Rust host glue，只承载标准 shell 的一部分；当前一方 App 均使用 Electron |
| examples | `examples/` | App SDK 示例与 Runtime CLI 示例（脚手架由 `@nimiplatform/app-tools` 生成） |

## 2. 前置环境

最低要求：

1. Go `1.24+`
2. Node.js `24+`
3. pnpm `10+`
4. Git

可选但常用：

1. Rust toolchain（构建 Kit 原生 carrier、Desktop 原生 Product Control 包或检查 Tauri shell crate 时需要）
2. `buf`（开发 proto 时常用）

快速检查：

```bash
go version
node -v
pnpm -v
```

## 3. 首次初始化（先配 `.env`）

在执行任何 `build` 前，先完成基础运行环境配置。

统一在仓库根目录 `nimi/.env` 创建环境文件：

```bash
# nimi/.env
NIMI_RUNTIME_BRIDGE_MODE=RUNTIME
NIMI_REALM_URL=http://localhost:3002
NIMI_CONTROL_PLANE_URL=http://localhost:46372
NIMI_WEB_URL=http://localhost:1420
```

说明：

1. Desktop 构建与运行统一只读取仓库根 `.env`（`nimi/.env`）。
2. 显式 `export` 的 shell 环境变量优先级最高。
3. `NIMI_RUNTIME_BRIDGE_MODE` 仅允许 `RUNTIME`/`RELEASE`；本地开发应使用 `RUNTIME`，发布环境使用 `RELEASE`。
6. 开源仓库只允许提交 `.env*.example` 模板；`*.env` 与 `*.env.*` 本地文件禁止提交。
7. `NIMI_REALM_URL` 是 Realm API 地址；`NIMI_CONTROL_PLANE_URL` 是 Runtime 控制面地址；`NIMI_WEB_URL` 是桌面网页登录入口地址（不要混用）。

完成 `.env` 后，在仓库根目录执行：

```bash
pnpm install
```

可选构建检查（需要上面的 `.env` 已配置）：

```bash
pnpm build
pnpm build:runtime
```

## 4. Runtime 快速启动（推荐先做）

### 4.1 准备 Product Control

先通过正常 Desktop 首次设置选择一次 Nimi 数据存储位置。选择记录固定写入
`~/.nimi/nimi.json` 的 `dataRoot.path`；后续 Desktop、Runtime、CLI 与测试均复用
该记录，不再要求第二个 root、路径参数或环境变量。

Windows 生产 Runtime 的私有配置和派生验证状态固定保存在
`%ProgramData%\Nimi\Runtime\Protected`，它不是第二份 Product Control，也不能覆盖
`dataRoot.path`。

`runtime:config:*` 只用于显式 nonproduction portable-config 实验；它没有默认文件
路径，且不得用于发现或覆盖 Nimi 数据根目录。

### 4.2 启动与健康检查

首次验证无需配置任何 provider 密钥。直接启动 runtime：

```bash
pnpm dev:runtime
```

新开一个终端：

```bash
pnpm runtime:health
pnpm runtime:config:get
```

默认地址：

1. gRPC: `127.0.0.1:46371`
2. HTTP: `127.0.0.1:46372`

### 4.3 配置 AI Provider 凭据（可选）

如需调用云端 AI provider（如 Gemini），通过 Desktop UI 管理 Connector。

启动 Desktop 后，在 Runtime Config 面板中添加 Connector 并填入 API Key。凭据由 Runtime ConnectorService 托管，Desktop renderer 不接触原始 key（K-KEYSRC-001、D-SEC-009）。

CLI 配置不拥有 provider 凭据；AI 调用由已认证 App 通过 SDK 的 typed Runtime client 发起。

## 5. SDK 快速验证

第三方 App 通过 Desktop 监督的宿主运行，并使用绑定宿主的 SDK client：

```ts
import { createNimiClient, type NimiLocalAppClient } from '@nimiplatform/sdk';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

const client: NimiLocalAppClient = createNimiClient({
  localApp: { standardShell: createNimiLocalAppStandardShellSurface() },
});
```

App 不传入 App ID、账号、token 或 Runtime 地址；Runtime 从受保护会话确定这些信息。
用 `@nimiplatform/app-tools` 生成的项目已包含这个 client。完整路径见
`docs/start/create-an-app.md` 与 `docs/sdk/first-ai-call.md`，可编译的示例在
`examples/sdk/`。带 App ID 的直连 `createNimiClient({ appId, runtime })` 只用于
Nimi App 之外的程序；通过普通 loopback gRPC 连接，Runtime 会拒绝 AI 执行、App
存储等 App 范围操作。

Kit 工具包（多数 app 均依赖）：

```ts
import { Button } from '@nimiplatform/kit/ui';
import { DesktopBrowserAuthGate } from '@nimiplatform/kit/auth/shell';
```

## 6. Desktop 与 Web 开发

### 6.1 Desktop

`.env` 配置规则见第 3 节。也可以临时用 shell 导出：

```bash
pnpm dev:desktop
```

### 6.2 Desktop 监督的 App

先运行并登录 Desktop，再从仓库根目录启动一方 App：

```bash
pnpm dev:lab
pnpm dev:zhiyu
pnpm dev:nimigo
pnpm dev:nimiday
```

这些 App 都由 Desktop supervisor 以 Electron 宿主启动。`pnpm dev:avatar` 单独启动
avatar-only Desktop carrier，不能与普通 `pnpm dev:desktop` 并行。端口与参数见
`LOCAL_DEVELOPMENT.md`。第三方 App 在自己的项目中运行 `pnpm dev`。

### 6.3 Web

```bash
pnpm --filter @nimiplatform/web dev
```

## 7. 常用开发命令

仓库根目录：

```bash
pnpm lint
pnpm test
pnpm build
```

聚焦 SDK：

```bash
pnpm --filter @nimiplatform/sdk lint
pnpm --filter @nimiplatform/sdk test
```

代码生成与协议：

```bash
pnpm generate:realm-sdk
pnpm proto:generate
pnpm proto:lint
```

Spec 一致性检查（PR 提交前必须通过）：

```bash
pnpm spec:authority:check
```

## 8. 必读规范（开始改代码前）

请先阅读以下文件：

1. `AGENTS.md`（仓库级规则，最高优先级）
2. 就近目录的 `*/AGENTS.md`（按改动路径匹配组件规则）
3. `.nimi/methodology/authority-authoring.yaml`（当改动 `.nimi/spec/**` 时必须遵循）
4. `.nimi/spec/` 目录下对应域的 canonical authority（规则内容本体）

兼容说明（避免歧义）：

- `CLAUDE.md`、`.github/copilot-instructions.md`、`*context.md` 仅作为工具兼容入口，不定义独立规则。
- 与任意 AGENTS 规则冲突时，以 `AGENTS.md` 与路径级 `*/AGENTS.md` 为准。

高频边界规则：

1. desktop/web 不得 import `runtime/internal/*`
2. SDK 不得跨 realm/runtime 不当耦合
3. 新增能力优先走 spec 契约定义，再做实现

## 9. 建议的开发流程

1. 拉取最新代码并确保工作区干净。
2. 先跑最小验证（runtime health + 目标组件 lint/test）。
3. 修改代码并运行对应局部测试。
4. 变更跨组件时再跑根目录 `pnpm lint` 与 `pnpm test`。
5. 变更 `.nimi/spec/**` 时，按 authoring methodology 执行 context/diff/impact/fmt，并跑 `pnpm spec:authority:check`。
6. 提交时按"可独立审查/可独立回滚"的边界拆 commit。

## 10. 常见问题

### Q1: Runtime 配置改了但没生效？

`nimi config set` 修改后必须重启 runtime；不支持热加载。

### Q2: AI 调用报凭据错误？

根据使用路径排查：

1. **Connector 路径**（Desktop UI 配置）：检查 Connector 是否为 `ACTIVE` 状态，凭据是否已填入。
2. **Config 路径**（CLI `apiKeyEnv`）：运行 `pnpm runtime:config:get` 检查 `apiKeyEnv` 字段，确认环境变量已在启动 runtime 的 shell 中导出。

## 11. 参考文档

1. `README.md`
2. `docs/start/index.md`
3. `runtime/README.md`
4. `docs/runtime/index.md`
5. `docs/sdk/index.md`
6. `.nimi/spec/runtime/ai-provider.authority.yaml`（Connector 与 Provider 领域 authority）
7. `.nimi/spec/runtime/security-core.authority.yaml`（Runtime 安全核与凭据路由 authority）

## 12. 附：统一 Runtime 命令入口

除快捷脚本外，也可以使用通用透传命令：

```bash
pnpm runtime:cmd -- <subcommand> [args]
```

例如：

```bash
pnpm runtime:cmd -- health --json
pnpm runtime:cmd -- doctor --json
```
