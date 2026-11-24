# Nimi 开发者首日入门指南 (Onboarding)

第一次开发原生生态 App，通常先打开与 App Tools 匹配的已安装 Nimi，登录官方 Realm，开启开发者模式，再在 App 工程运行 `pnpm dev`。如果机器上已有满足任务要求的 Home，可以直接使用。[App Tools 开发指南](app-tools/README.md#3-desktop-supervised-development)

修改 Home、Runtime、SDK 或 Kit 时，使用公开仓库的源码 Runtime 和官方 Realm。只有联调 Realm 或需要受控数据才选 `local`。准备好工具链后，先用 `pnpm doctor:dev` 查看本次目标与活动环境，再决定是否启动 Home。[如何判断能否复用](LOCAL_DEVELOPMENT.md#先判断能否复用)

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

- **Node.js**：`>= 24.22.3 < 25`（Node 24 LTS 分支）
- **pnpm**：`10.34.7`（与根目录 `packageManager` 保持一致）
- **Go**：`>= 1.26.11`（编译和调试 Runtime 必备，具体版本以 `runtime/go.mod` 为准）
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

默认的官方 Realm 提供 API 与浏览器登录页，账号使用真实云端数据。公开仓库和本机工具链就足以开发 Nimi。

### 步骤 1（可选）· 指定开发环境
在仓库根目录按需新建 `.env`（参考 `.env.example`）。普通 Nimi 开发无需配置 Realm 地址；以下示例沿用官方默认值：

```bash
# nimi/.env
NIMI_RUNTIME_BRIDGE_MODE=RUNTIME
NIMI_DEV_REALM=official
```

> **参数说明**：
> - `NIMI_RUNTIME_BRIDGE_MODE`：本地源码联调请固定使用 `RUNTIME`（发布测试使用 `RELEASE`）。
> - `NIMI_DEV_REALM`：`official`（默认）或 `local`；命令行 `--realm` 优先。local 地址使用 `.env.example` 的 `NIMI_DEV_*` 输入。
> - `NIMI_DEV_REALM_DIR`：可选的 Realm 开发工程目录，供 Desktop 启动器调用工程自己的数据服务检查、API 和实时服务脚本。
> - Home 的浏览器登录地址及一次性回环回调由 Runtime 签发。
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

## 4. 启动源码环境与判断状态

在仓库根目录运行 `pnpm doctor:dev -- --host source --realm official`。本地 Realm 联调将 `official` 换为 `local`。诊断会列出请求的目标、探测到的宿主与 Realm API，以及 Runtime 能否复用。目标匹配且 Home 已打开，就在当前窗口继续。有冲突时先与使用这台机器的开发者协调。各项结果的含义见[本地开发指南](LOCAL_DEVELOPMENT.md#先判断能否复用)。

需要单独观察 Runtime 前台日志时，可以用 `pnpm dev:runtime` 启动 supervisor，随后用同一 Realm 的 Home 复用它。

按实际层次检查：

| 层次 | 查看什么 |
| --- | --- |
| 开发服务与进程 | 启动终端及 `.nimi/local/dev-services/` 日志中的实际错误 |
| Home 接入 | 正式 Home 窗口是否完成数据目录设置、Runtime 接入和浏览器登录 |
| App Access | 目标 App 通过正式入口启动后显示的当前访问状态；Developer Mode 本身不授予权限 |
| 模型执行 | 在主机准备 Local Loadout 或 Cloud Connector，保存对应 AIConfig 后执行一次真实调用 |

`pnpm runtime:health` 和 `nimi health --json` 查询受支持的固定服务控制器，返回 `service-running` 或 `stopped`。它们不检测源码 supervisor、普通端口或 AI 就绪；在没有该控制器的系统（包括当前 macOS 路径）会明确失败。Windows 已安装固定服务的诊断见 [Runtime CLI](docs/runtime/cli-and-daemon.md)。

---

## 5. 启动桌面客户端 (Nimi Desktop)

需要启动对接官方 Realm 的源码 Home 时，在仓库根目录执行以下命令。没有设置 `NIMI_DEV_REALM` 的新工作区可简写为 `pnpm dev:desktop`。

```bash
pnpm dev:desktop -- --realm official
```

启动器在默认官方模式下准备源码 Runtime 并打开 Electron。需要本地服务时，运行 `pnpm dev:desktop -- --realm local`，复用符合要求的 Realm API、Realtime 与登录页。缺失的 Realm 服务可用 `NIMI_DEV_REALM_DIR` 指定的工作区启动。关闭 Desktop 时，启动器会清理本次创建的开发进程。完整配置与切换影响见[本地开发指南](LOCAL_DEVELOPMENT.md#切换会影响什么)。

启动后：
1. 首次运行会引导选择数据目录。源码环境在该 Realm 模式的 Product Control 记录中保存 `dataRoot.path`。
2. 在浏览器弹出的页面中完成 Nimi 账号登录授权。
3. 登录后即可在 Nimi Home 中体验角色对话、本地模型管理与内置应用。

### 启动 Desktop 监督的生态应用
在 Desktop 保持运行并处于登录状态时，你可以在根目录下直接启动受其监管的生态应用：

```bash
pnpm dev:lab       # Nimi Lab 能力测试台
pnpm dev:zhiyu     # 织羽 (Zhiyu) AI 伙伴
pnpm dev:harness   # Nimi Harness 智能助理与 PC 工作台
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
1. 查看 `pnpm dev:desktop` 的启动日志和 Home 当前接入状态；独立 Runtime 调试查看 `pnpm dev:runtime` 前台日志。先区分进程、账号与 App Access 是否就绪。
2. 在 Nimi Home 的「云服务」中确认已添加对应的 Connector，且该模型提供商处于正常可用状态。
3. 如果调用的是本地模型，请在 Nimi 的 AI 能力设置中确认对应的本地运行方案与依赖已经就绪。

### Q3：想使用统一的 Runtime CLI 调试底层？
可以使用根目录提供的命令透传工具。以下健康检查与 doctor 中的服务检查仅适用于已安装且受支持的固定服务；它们不管理源码 supervisor，在缺少控制器的系统会失败：
```bash
pnpm runtime:cmd -- health --json
pnpm runtime:cmd -- doctor --json
```

祝你开发愉快！如果遇到未涵盖的问题，欢迎在 Discord 或 GitHub Issue 中与团队交流。

---

## 附录 · 维护媒体 0.22 历史开发检查点

`media-cdn-preview-2026-10-26` 是配套 Realm 媒体合同的开发检查点，并非生产发布。SDK / Kit 0.22.0、Runtime、原生承载与 Home 必须使用匹配源码重新构建；仅拉取前端代码或修改依赖版本字符串，无法让旧 Runtime 的 broker/protobuf 支持新媒体操作。

两仓独立更新，配套 Realm 代码的 SHA 见该 checkpoint 对应 Nimi 媒体提交中的 `Companion-Realm`。Realm 仓库根目录的 `MEDIA-CHECKPOINT.md` 是跨机数据适配入口，说明了现有数据库保护要求和工具适用边界。仅运行客户端的机器只需配置实际可访问的 Realm 并正常登录，不运行 Realm 数据迁移，也不需要 R2 写凭据。`localhost:3002` 指向本机；没有可访问的共享 Realm 时，不要将它当作远端服务。

自行运行 Realm 的机器需先确认数据库与媒体发布 owner：不同数据库不得直接向同一预览发布空间写入。不要复制用户 token、Runtime 数据目录或整份 `.env`，也不要重置旧数据库；当前一次性媒体工具不是任意机器通用的迁移器。同时采用新介绍合同的独立 App 还需在根目录提供 `NIMI_APP.md`，不支持 README 回退。

2026-10-28 首发准备已将媒体交付切至 policy v2：大幅静态主图提前生成，Runtime 同步修复了写死 v1 的描述与原始语音链接校验。升级时必须重新构建并正常重启匹配的 Runtime，不能只更新 Realm/Worker。最新配套代码、内容 revision 11 与生产变更预览见 Realm 的 `docker/production/MEDIA-LAUNCH.md`。

2026-10-28 经明确批准，Cloudflare 账号已启用 Workers Paid，预览 Worker 单请求 CPU 限额为 1000ms；冷 MISS 主图 p95 为 1.773秒，新的真实页面验收未再观察到非取消的媒体请求失败。该结果仅解除本机/预览的 CPU 配额阻断；Windows、管理员界面、多 POP 和生产目标仍有未验证范围。代码、协议、数据准备与真实产品验收须分别核对，不能将构建通过或本机样本视为生产就绪。
