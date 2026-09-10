# 开发环境与可用性

开发第三方 Nimi App，先准备项目工具链。通过 Nimi 运行 App 并调用能力时，还需要兼容的 Nimi Home 开发实例和 Runtime。

## 创建并检查项目

使用 Node.js 24 或更新版本以及 pnpm，然后按[创建 Nimi App](/zh/start/create-an-app)操作。该指南固定使用 App Tools 0.2.7，便于把命令与生成依赖对应到同一发布版本。

| 组件 | App Tools 0.2.7 的生成声明 | 用途 |
| --- | --- | --- |
| `@nimiplatform/app-tools` | `^0.2.7` | 创建、初始化、同步、检查、运行、测试、构建与打包 App |
| `@nimiplatform/sdk` | `^0.9.0` | Nimi 公开能力接口 |
| `@nimiplatform/nimi-coding` | `0.6.1` | 供项目初始化与检查使用的受管投影工具 |
| `@nimiplatform/kit` | 以生成项目的声明为准 | 共享 App UI 与宿主集成 |

这张表说明已发布脚手架的依赖，不表示各个依赖都应独立升级到最新版本。选择其他 App Tools 版本时，以该版本生成的 manifest 和帮助为准。当前 Nimi workspace 中的 App Tools 0.2.8 声明 SDK `^0.10.0` 和 nimicoding `0.6.2`，不能把这些 workspace 值写成 0.2.7 发布包的输出。

Standalone 项目使用公开包；`workspace:*`、源码别名和 Nimi 内部的 workspace 验证不是第三方安装路径。以上对应 [App Tools 0.2.7](https://www.npmjs.com/package/@nimiplatform/app-tools/v/0.2.7)。

## 通过 Nimi Home 运行

开发命令会请求 Desktop（当前的 Nimi Home 宿主）启动受监督的 Electron App。通过 Developer Mode 登记本地项目，并配置 App 所需访问。看见窗口不等于 Runtime 访问或 AI 能力已经准备完成。

当前尚未发布面向普通用户的 Nimi 稳定版安装器。[官方下载页](https://nimi.ai/download)列出各平台的真实可用范围与开发构建要求。Windows Runtime bootstrap 是便携的开发组件，不包含 Nimi Home、安装器或受保护产品环境，不能代替 Home 开发环境。

尚无兼容的 Home/Runtime 开发实例时，可以先准备项目并完成静态检查；受管启动与能力执行仍需等该前提具备后验证。根据宿主实际错误查[故障排查](/zh/start/troubleshooting)，不要直接打开 renderer 绕过访问要求。

## 接入能力与准备分发

- [第一次 AI 调用](/zh/sdk/first-ai-call)：请求与能力意图要求。
- [在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)：生成项目的宿主绑定与共享接口。
- [本地开发与对外分发](/zh/start/#本地开发与对外分发)：Developer Mode、Registry 安装包、不可变本地包导入及当前平台限制。
- [网页端与 Nimi Home](/zh/desktop/web-mode)：公开站点与账户页面的边界；网站不是 Desktop 的 Web 适配器。

创建或运行项目不会发布 App，也不授予 Registry 准入。进入分发阶段时，按 App Tools 的实际发布与打包说明操作。

## 直接使用 Nimi Coding

生成 App 已声明必需的 nimicoding 依赖，`pnpm run init` 会调用其同步机制。这是真实工具链依赖，不要求开发者先单独学习 Nimi 主仓的内部治理流程。

希望在自己的工作中直接使用规范管理工具时，可以阅读 Nimi Coding 的[概览](/zh/nimicoding/)与[安装指南](/zh/nimicoding/installation)。

## 来源依据

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`app-tools/package.json`](https://github.com/nimiplatform/nimi/blob/main/app-tools/package.json)
- [`app-tools/lib/app-scaffold.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-scaffold.mjs)
- [`app-tools/lib/app-doctor-update.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-doctor-update.mjs)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
