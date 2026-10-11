# 开发环境准备

本指南介绍如何搭建 Nimi 开发环境，适用于使用 App Tools 0.11.4、SDK 0.21.0、Kit 0.18.0 以及对应版本的本地 Runtime。同时支持可选的 Vercel AI SDK 适配器（0.5.0）与 Tauri 容器（0.10.0）。

## 基础工具链

- **Node.js**：要求 Node.js 24 或更高版本（`engines.node >= 24.0.0`）。
- **pnpm**：固定使用 pnpm 10.34.5（或兼容的 pnpm 10.x）。
- **Nimi Coding**：App 项目通过项目本地的 Nimi Coding（0.6.5）进行规范检查，安装依赖后通过 `pnpm run init` 自动完成初始化。

准备好完整的 App Tools、SDK、Kit，以及与当前系统架构匹配的 Kit 原生包。可通过当前源码打包流程构建，或使用配套的开发交付包。Kit 的原生包为可选依赖，其版本与 Kit 保持一致。

## 选择依赖版本组合

本指南显式选用支持的开发依赖组合 SDK `^0.21.0` 与 Kit `^0.18.0`（若使用 Tauri 容器，对应版本为 0.10.0）。注意脚手架模板默认生成 `^0.18.1` / `^0.15.3`；生成工程后请在 `package.json` 与工作区 overrides 中显式改选这两项依赖。

在实际开发中，可以在 `package.json` 中声明版本，并通过 `pnpm-workspace.yaml` 的 overrides 指向本地归档。具体操作细节可参考[创建 App](/zh/start/create-an-app)。建议保持核心依赖包版本一致，以确保 Runtime 与原生接口的稳定性。

## 运行与本地调试

1. **启动 Nimi Home 与 Runtime**：准备好本地的 Nimi Home 与 Runtime 服务。Nimi Home 需要登录 Nimi 账户。
2. **注册与授权**：在 Nimi Home 的开发者模式（Developer Mode）中注册你的应用项目并授予相应权限。
3. **启动调试**：在应用工程根目录下运行 `pnpm dev`，系统将在受桌面端托管的 Electron 调试环境中启动应用。

应用窗口启动后，先确认 Nimi Home 中已备好本机模型或云端连接器，再通过客户端保存应用自身的能力路由意图，并验证完整的调用链路。

查看各平台桌面客户端的当前下载与发布状态，可访问[官方下载页面](https://nimi.ai/download)。

## 延伸阅读

- [创建第一个 Nimi App](/zh/start/create-an-app)
- [发起第一次 AI 调用](/zh/sdk/first-ai-call)
- [AI 能力配置（AIConfig）](/zh/sdk/ai-config-surface)
- [常见问题与故障排查](/zh/start/troubleshooting)
- [应用开发与分发模式](/zh/start/#本地开发与分发模式)

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`app-tools/lib/app-dependency-combinations.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-dependency-combinations.mjs)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
