# 开发 Nimi App

这组指南面向 Nimi ecosystem 的第三方 App 开发者：先建立本地项目，接入需要的能力，再按相应要求准备分发。

## 从一个本地项目开始

1. [准备开发环境](/zh/start/install)。创建项目和静态检查需要 Node.js 与 pnpm；受管运行还需要兼容的 Nimi Home 开发实例和 Runtime。
2. [创建 App](/zh/start/create-an-app)。安装依赖、初始化生成项目，完成检查后再启动开发宿主。
3. [了解第一次 AI 调用](/zh/sdk/first-ai-call)。核对 App 身份、能力意图和访问要求，处理真实返回结果；生成项目继续使用提供的 SDK/Kit 宿主绑定。
4. 遇到失败时查[接入故障排查](/zh/start/troubleshooting)，根据实际错误决定修正什么，再重试相同步骤。

需要共享 UI 或宿主集成时，读[在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)。需要具体能力示例时，读[使用 Nimi Lab](/zh/start/use-nimi-lab)。

## 本地开发与分发模式

Nimi App 提供三条独立的接入与分发路径：
- **开发者模式（Developer Mode）**：直接在本地启动未打包的开发项目，由桌面端监督运行并连接 Runtime，便于快速调试迭代。
- **本地包导入**：导入经过打包的不可变应用包进行本地私有测试与验证；这不代表已在官方 Registry 发布。
- **Registry 目录分发**：经审核后收录进入官方应用目录，供用户浏览与安装。

在当前版本中，应用管理与访问控制支持 macOS (arm64) 与 Windows (x86_64)；其他平台的包生命周期与普通修复仍不可用。准备对外发布时，请参考 [App Tools 发布说明](https://github.com/nimiplatform/nimi/tree/main/app-tools#canonical-release-boundary)。

## 按需要查参考

- [SDK](/zh/sdk/)与 [SDK 边界](/zh/sdk/boundaries)：公开接入接口。
- [Runtime](/zh/runtime/)：执行、配置和失败行为。
- [平台](/zh/platform/)与[术语表](/zh/reference/glossary)：产品概念。
- [Nimi Coding](/zh/nimicoding/)：直接使用规范管理工具。生成 App 的初始化已经处理工具链所需的集成。

想了解个人 AI 产品或普通用户下载状态，请访问[官网](https://nimi.ai)和[下载页](https://nimi.ai/download)。使用 Nimi Home 需要 Nimi 账号，并在浏览器中登录。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`nimi-coding/README.zh-CN.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.zh-CN.md)
