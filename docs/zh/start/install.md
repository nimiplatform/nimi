# 开发环境准备

配置好 Nimi 开发环境后，你就可以在本机开发和调试本地优先的 AI 应用、联调原生宿主交互，并运行端到端测试。

开发时请选用与当前 Nimi 宿主匹配的 App Tools 版本，并沿用它生成的依赖组合。当前仓库源码声明的版本为 App Tools 0.13.1、SDK 0.21.0 与 Kit/native 0.21.0（源码中的版本声明不代表对应包已发布至 npm）。

---

## 1. 基础工具链要求

开始前，请确认本机已安装以下工具：

- **Node.js**：使用 Node.js 24.22.1 或 Node 24 LTS 分支上更新的补丁/次版本。
- **pnpm**：推荐使用 pnpm 10.34.7（或兼容的 pnpm 10.x 版本）。
- **C/C++ 构建工具**（可选）：若需从源码编译 Kit 的可选原生扩展，macOS 请安装 Xcode Command Line Tools，Windows 请安装 Visual Studio C++ 生成工具。

脚手架生成的 App 工程内置项目级 Nimi Coding，其版本由所选 App Tools 包锁定；当前源码脚手架锁定为 0.7.0。执行 `pnpm install && pnpm run init` 即可完成初始化，无需全局安装。

---

## 2. 核心依赖组合说明

Nimi 核心模块之间通过明确的契约协同工作。当前源码脚手架声明的依赖组合如下；若从 npm 安装，请以所选已发布工具生成的版本声明为准：

| 模块 | 源码脚手架版本 | 说明 |
| :--- | :--- | :--- |
| `@nimiplatform/sdk` | `^0.21.0` | 客户端核心 API、AI 推理与宿主会话绑定 |
| `@nimiplatform/kit` | `^0.21.0` | 跨平台 UI 组件库、窗口桥接与主题契约 |
| `@nimiplatform/app-tools` | `^0.13.1` | 项目脚手架与构建打包工具 |
| `@nimiplatform/sdk-adapter-vercel-ai` | `^0.5.0` | （可选）Vercel AI SDK 7 适配器 |

> [!NOTE] 本地归档与覆盖
> 在主仓库源码中开发或使用离线开发包时，可在项目根目录通过 `pnpm-workspace.yaml` 的 `overrides` 字段将上述依赖直接指向本地 `.tgz` 归档文件。具体配置方式请参考[创建第一个 Nimi App](/zh/start/create-an-app)。

---

## 3. 本地调试三步走

如果基于 Nimi 源码开发，请先按[仓库环境准备指南](https://github.com/nimiplatform/nimi/blob/main/ONBOARDING.md)配置好 Go、原生构建工具与环境变量，源码 Runtime 启动器连接另行准备的 `http://127.0.0.1:3002` Realm 服务；下列命令不会启动 Realm。随后保持以下三个进程运行：

### 第一步：启动本地 Runtime 服务
在 Nimi 主仓库根目录下运行：
```bash
pnpm dev:runtime
```
该命令会启动本地用户态 Runtime 服务，负责本地模型调度、密钥存储与会话管理。

### 第二步：启动 Nimi Desktop / Home
打开第二个终端窗口，在主仓库根目录下运行：
```bash
pnpm dev:desktop
```
桌面窗口启动后，登录 Nimi 账号进入 Nimi Home。在启动你的应用前，请前往**设置 → 开发者**开启 Developer Mode，并单独确认该应用的 Nimi Access 会话已就绪。

### 第三步：启动你的 App
进入你的应用工程根目录，运行：
```bash
pnpm dev
```
应用将在受桌面端监管的窗口中启动，并向本地 Runtime 请求受保护会话。启动完成后，即可在界面中测试 AI 功能、配置路由或调试推理请求。

---

## 4. 常见问题排查与延伸

- 遇到服务未连接或缺少权限等提示？请查阅[常见问题与故障排查](/zh/start/troubleshooting)。
- 只想直接体验已发布的官方桌面客户端？请前往 [Nimi 官网下载页](https://nimi.ai/download)。

## 接下来

- [创建第一个 Nimi App](/zh/start/create-an-app)
- [发起第一次 AI 调用](/zh/sdk/first-ai-call)
- [AI 能力配置（AIConfig）](/zh/sdk/ai-config-surface)

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`app-tools/lib/app-dependency-combinations.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-dependency-combinations.mjs)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
