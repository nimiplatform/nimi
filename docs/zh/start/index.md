# 开发 Nimi App

这组指南面向 Nimi ecosystem 的第三方 App 开发者：先建立本地项目，接入需要的能力，再按相应要求准备分发。

## 从一个本地项目开始

1. [准备开发环境](/zh/start/install)。创建项目和静态检查需要 Node.js 与 pnpm；受管运行还需要兼容的 Nimi Home 开发实例和 Runtime。
2. [创建 App](/zh/start/create-an-app)。安装依赖、初始化生成项目，完成检查后再启动开发宿主。
3. [了解第一次 AI 调用](/zh/sdk/first-ai-call)。核对 App 身份、能力意图和访问要求，处理真实返回结果；生成项目继续使用提供的 SDK/Kit 宿主绑定。
4. 遇到失败时查[接入故障排查](/zh/start/troubleshooting)，根据实际错误决定修正什么，再重试相同步骤。

需要共享 UI 或宿主集成时，读[在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)。需要具体能力示例时，读[使用 Nimi Lab](/zh/start/use-nimi-lab)。

## 本地开发与对外分发

Nimi App 有三条独立路径：Registry 批准的安装包、用户明确选择的不可变本地包导入，以及不使用安装包的 Developer Mode 项目。本指南从本地开发开始；创建项目或打开窗口本身不会授予 Nimi Access，也不会发布 App。

当前预发布允许已明确配置的试点 App 仓库通过受保护 tag 触发 GitHub Actions，并发布不可变 GitHub Release；静态 Registry 的接入和描述符准入需要人工批准。Windows x86_64 已支持验证目录发现、安装、启动/聚焦/停止、受保护会话 Access 和卸载。本地包导入入口、其他平台的包生命周期、普通更新与修复仍不可用；内置或平台 App 另有规则。

准备分发前，请阅读 [App Tools 发布说明](https://github.com/nimiplatform/nimi/tree/main/app-tools#canonical-release-boundary)。本地运行、发布制品、Registry 准入、安装状态和访问能力各自独立，不能相互代替。

## 按需要查参考

- [SDK](/zh/sdk/)与 [SDK 边界](/zh/sdk/boundaries)：公开接入接口。
- [Runtime](/zh/runtime/)：执行、配置和失败行为。
- [平台](/zh/platform/)与[术语表](/zh/reference/glossary)：产品概念。
- [Nimi Coding](/zh/nimicoding/)：直接使用规范管理工具。生成 App 的初始化已经处理工具链所需的集成。

想了解个人 AI 产品或普通用户下载状态，请访问[官网](https://nimi.ai)和[下载页](https://nimi.ai/download)。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`nimi-coding/README.zh-CN.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.zh-CN.md)
