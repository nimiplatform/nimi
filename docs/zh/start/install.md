# 开发环境与可用性

开发第三方 Nimi App，先准备项目工具链。通过 Nimi 运行 App 并调用能力时，还需要兼容的 Nimi Home 开发实例和 Runtime。

## 创建并检查项目

使用 Node.js 24 或更新版本以及 pnpm，然后按[创建 Nimi App](/zh/start/create-an-app)操作。该指南固定使用 App Tools 0.7.5，便于把命令与生成依赖对应到同一发布版本。

| 组件 | App Tools 0.7.5 的生成声明 | 用途 |
| --- | --- | --- |
| `@nimiplatform/app-tools` | `^0.7.5` | 创建、初始化、同步、检查、运行、测试、构建与打包 App |
| `@nimiplatform/sdk` | `^0.15.0` | Nimi 公开能力接口 |
| `@nimiplatform/kit` | `^0.11.0` | 共享 App UI 与宿主集成 |
| `@nimiplatform/nimi-coding` | `0.6.3` | 供项目初始化与检查使用的受管投影工具 |

这张表说明已发布脚手架的依赖，不表示各个依赖都应独立升级到最新版本。SDK 与 Kit 的版本是一组受支持的组合；选择其他 App Tools 版本时，以该版本生成的 manifest 和帮助为准。

Standalone 项目使用公开包；`workspace:*`、源码别名和 Nimi 内部的 workspace 验证不是第三方安装路径。以上对应 [App Tools 0.7.5](https://www.npmjs.com/package/@nimiplatform/app-tools/v/0.7.5)。

## 通过 Nimi Home 运行

开发命令会请求 Desktop（当前的 Nimi Home 宿主）启动受监督的 Electron App。通过 Developer Mode 登记本地项目，并配置 App 所需访问。看见窗口不等于 Runtime 访问或 AI 能力已经准备完成。

目前没有发布任何 Nimi Home 或 Runtime 下载，开发构建也没有；早期的开发者预览和便携 Windows Runtime bootstrap 都已撤下。当前状态以[官方下载页](https://nimi.ai/download)为准。使用 Nimi Home 还需要 Nimi 账号：使用前要先在浏览器中登录。

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
- [`app-tools/lib/app-dependency-combinations.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-dependency-combinations.mjs)
- [`app-tools/lib/app-scaffold.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-scaffold.mjs)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
