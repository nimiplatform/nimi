# Nimi Onboarding

本指南面向首次加入 `nimi` 仓库的开发者，目标是让你在第一天完成以下结果：

1. 本地环境安装完成。
2. `runtime` 可启动并返回健康状态。
3. `sdk`、`desktop`、`web`、`landing` 至少一个开发面可运行。
4. 了解最基本的仓库边界、质量门禁和提交流程。

## 1. 仓库与组件

`nimi` 是一个多组件 monorepo，核心组件如下：

| 组件 | 目录 | 语言 |
|---|---|---|
| runtime | `runtime/` | Go |
| sdk | `sdk/` | TypeScript |
| desktop | `apps/desktop/` | Tauri + React |
| web | `apps/web/` | React |
| landing | `apps/landing/` | React |
| proto | `proto/` | Protocol Buffers |
| docs | `docs/` | Markdown |

`nimi-mods/` 在本仓库内作为目录存在，但它本身是独立 Git 仓库，单独维护与拉取。

## 2. 前置环境

最低要求：

1. Go `1.24+`
2. Node.js `24+`
3. pnpm `10+`
4. Git

可选但常用：

1. Rust toolchain（开发 desktop Tauri 时需要）
2. `buf`（开发 proto 时常用）

快速检查：

```bash
go version
node -v
pnpm -v
```

## 3. 首次初始化（先配 `.env`）

在执行任何 `build` 前，先完成 desktop/mods 环境变量配置。

统一在仓库根目录 `nimi/.env` 创建环境文件：

```bash
# nimi/.env
NIMI_MODS_ROOT=/Users/<you>/nimi-realm/nimi/nimi-mods
NIMI_RUNTIME_MODS_DIR=/Users/<you>/nimi-realm/nimi/nimi-mods
NIMI_RUNTIME_BRIDGE_MODE=RUNTIME
NIMI_REALM_URL=http://localhost:3002
NIMI_CONTROL_PLANE_URL=http://localhost
NIMI_WEB_URL=http://localhost
```

说明：

1. `NIMI_MODS_ROOT` 与 `NIMI_RUNTIME_MODS_DIR` 必须是存在的绝对路径。
2. Desktop 构建与运行统一只读取仓库根 `.env`（`nimi/.env`）。
3. 显式 `export` 的 shell 环境变量优先级最高。
4. 常见错误是仍保留占位值 `/ABS/PATH/TO/nimi-mods`，会导致 `pnpm build` 失败。
5. `NIMI_RUNTIME_BRIDGE_MODE` 仅允许 `RUNTIME`/`RELEASE`；本地开发应使用 `RUNTIME`，发布环境使用 `RELEASE`。
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

### 4.1 初始化配置文件

Runtime 配置文件路径是 `~/.nimi/config.json`（可被 `NIMI_RUNTIME_CONFIG_PATH` 覆盖）。

```bash
pnpm runtime:config:init
pnpm runtime:config:validate
```

### 4.2 启动与健康检查

首次验证无需配置任何 provider 密钥。直接启动 runtime：

```bash
pnpm runtime:serve
```

新开一个终端：

```bash
pnpm runtime:health
pnpm runtime:providers
pnpm runtime:config:get
```

默认地址：

1. gRPC: `127.0.0.1:46371`
2. HTTP: `127.0.0.1:46372`

### 4.3 配置 AI Provider 凭据（可选）

如需调用云端 AI provider（如 Gemini），有两种方式配置凭据：

**方式 A：通过 Desktop UI 管理 Connector（推荐）**

启动 Desktop 后，在 Runtime Config 面板中添加 Connector 并填入 API Key。凭据由 Runtime ConnectorService 托管，Desktop renderer 不接触原始 key（K-KEYSRC-001、D-SEC-009）。

**方式 B：通过 config.json 环境变量引用（CLI 场景）**

适用于无 Desktop 的纯 CLI 开发/调试：

```bash
export GEMINI_API_KEY="<your-gemini-key>"
pnpm runtime:cmd -- config set --set providers.gemini.apiKeyEnv=GEMINI_API_KEY --json
```

说明：

1. 禁止将明文 `apiKey` 写入配置文件（校验会拒绝）。
2. `apiKeyEnv` 引用环境变量名，runtime 启动时从环境读取。
3. 修改 config 后必须重启 runtime 才生效。
4. Gemini 在有 key 且未设置 base URL 时，默认走 `https://generativelanguage.googleapis.com/v1beta/openai`。

### 4.4 首次 AI 调用

```bash
pnpm runtime:run:hello
```

## 5. SDK 快速验证

安装（在你自己的应用中）：

```bash
pnpm add @nimiplatform/sdk
```

最小示例（Runtime + Realm）：

```ts
import { Runtime, Realm } from '@nimiplatform/sdk';

const runtime = new Runtime({
  appId: 'my_app',
  transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});

const realm = new Realm({
  baseUrl: 'https://api.nimi.xyz',
});
```

当前 SDK 主入口是 `Runtime` / `Realm`。不要使用 `createNimiClient`。

Runtime 实例暴露以下模块：`auth`、`appAuth`、`ai`、`media`、`model`、`localRuntime`、`connector`、`knowledge`、`workflow`、`app`、`audit`、`scope`、`events`、`raw`。

## 6. Desktop 与 Web 开发

### 6.1 Desktop（含 mods 联调）

`.env` 配置规则见第 3 节。也可以临时用 shell 导出：

```bash
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
export NIMI_RUNTIME_MODS_DIR="$NIMI_MODS_ROOT"
pnpm -C apps/desktop run dev:shell
```

本地联调 smoke：

```bash
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
export NIMI_RUNTIME_MODS_DIR="$NIMI_MODS_ROOT"
pnpm run check:desktop-mods-smoke:local-chat
```

### 6.2 Web

```bash
pnpm --filter @nimiplatform/web dev
```

### 6.3 Landing（独立静态站）

```bash
pnpm --filter @nimiplatform/landing dev
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
pnpm check:sdk-vnext-matrix
pnpm check:sdk-consumer-smoke
```

代码生成与协议：

```bash
pnpm generate:realm-sdk
pnpm generate:scope-catalog
pnpm proto:generate
pnpm proto:lint
```

Spec 一致性检查（PR 提交前必须通过）：

```bash
pnpm check:runtime-spec-kernel-consistency
pnpm check:sdk-spec-kernel-consistency
pnpm check:desktop-spec-kernel-consistency
```

## 8. 必读规范（开始改代码前）

请先阅读以下文件：

1. `AGENTS.md`（仓库级规则，最高优先级）
2. 就近目录的 `*/AGENTS.md`（按改动路径匹配组件规则）
3. `spec/AGENTS.md`（当改动 `spec/**` 时必须遵循）
4. `spec/` 目录下对应域的规范文档（规则内容本体）

兼容说明（避免歧义）：

- `CLAUDE.md`、`.github/copilot-instructions.md`、`*context.md` 仅作为工具兼容入口，不定义独立规则。
- 与任意 AGENTS 规则冲突时，以 `AGENTS.md` 与路径级 `*/AGENTS.md` 为准。

高频边界规则：

1. desktop/web 不得 import `runtime/internal/*`
2. SDK 不得跨 realm/runtime 不当耦合
3. mods 不得绕过 hook 直接调用 SDK runtime
4. 新增能力优先走 spec 契约定义，再做实现

## 9. 建议的开发流程

1. 拉取最新代码并确保工作区干净。
2. 先跑最小验证（runtime health + 目标组件 lint/test）。
3. 修改代码并运行对应局部测试。
4. 变更跨组件时再跑根目录 `pnpm lint` 与 `pnpm test`。
5. 变更 spec/源码对齐关系时，跑 `pnpm check:*-spec-kernel-consistency`。
6. 提交时按"可独立审查/可独立回滚"的边界拆 commit。

## 10. 常见问题

### Q1: Runtime 配置改了但没生效？

`nimi config set` 修改后必须重启 runtime；不支持热加载。

### Q2: AI 调用报凭据错误？

根据使用路径排查：

1. **Connector 路径**（Desktop UI 配置）：检查 Connector 是否为 `ACTIVE` 状态，凭据是否已填入。
2. **Config 路径**（CLI `apiKeyEnv`）：运行 `pnpm runtime:config:get` 检查 `apiKeyEnv` 字段，确认环境变量已在启动 runtime 的 shell 中导出。

### Q3: 为什么 `git pull nimi-mods` 在主仓库会出问题？

`nimi-mods/` 是独立仓库。请进入子目录执行：

```bash
cd nimi-mods
git pull --rebase
```

## 11. 参考文档

1. `README.md`
2. `docs/getting-started/index.md`
3. `runtime/README.md`
4. `docs/reference/runtime.md`
5. `docs/reference/sdk.md`
6. `spec/runtime/connector.md`（Connector 领域规范）
7. `spec/runtime/kernel/key-source-routing.md`（凭据路由规范）

## 12. 附：统一 Runtime 命令入口

除快捷脚本外，也可以使用通用透传命令：

```bash
pnpm runtime:cmd -- <subcommand> [args]
```

例如：

```bash
pnpm runtime:cmd -- health --source grpc
pnpm runtime:cmd -- providers --source grpc
pnpm runtime:cmd -- config set --set providers.gemini.apiKeyEnv=GEMINI_API_KEY --json
```
