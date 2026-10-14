# Nimi App 开发快速入门

欢迎来到 Nimi 开发者生态！无论你是想打造一个专注特定场景的私有本地 AI 助手，还是计划为广大的 Nimi 桌面端用户构建一款功能丰富的生态应用，这组指南都能带你从零起步，走完从创建、本地调试到打包分发的完整流程。

---

## 4 步走通你的第一个应用

1. **[准备开发环境](/zh/start/install)**：安装 Node.js 与 pnpm，启动作为调试宿主的 Nimi Desktop 与本地 Runtime 守护进程。
2. **[快速创建 App](/zh/start/create-an-app)**：使用 `@nimiplatform/app-tools` 脚手架生成具备受保护宿主访问能力的标准工程，在热重载环境下高效开发。
3. **[发起第一次 AI 调用](/zh/sdk/first-ai-call)**：通过强类型的 Nimi SDK 请求文本生成、流式对话或多模态推理，无需手动管理底层凭据或 RPC 端点。
4. **[常见问题与排错](/zh/start/troubleshooting)**：遇到服务未连接、权限缺失或模型未配置？对照排错指南快速定位并解决问题。

> **进阶探索**：
> - 需要统一的界面组件与设计规范？查阅 [在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)。
> - 想在交互式实验台中直观测试各项模型能力？查阅 [使用 Nimi Lab](/zh/start/use-nimi-lab)。

---

## 三种运行与分发形态

Nimi 提供三种运行与分发路径，分别服务于源码开发、本地安装和目录发现：

- **开发者模式 (Developer Mode)**：直接运行本地未打包的源码工程，由 Nimi Desktop 托管进程生命周期，支持前端热重载与实时调试。
- **本地包导入 (Local Import)**：手动选择打包后的不可变应用归档包，导入 Nimi Desktop 进行本地验证（macOS arm64 与 Windows x86_64 已有实现；整体产品验收与公开发布准备仍需单独确认）。
- **官方应用目录分发 (Registry Catalog)**：应用通过官方 Registry 准入审核后，用户即可在 Nimi Home 中发现、安装与更新。应用包的签名由发布者自行负责；Registry 审核仅覆盖目录准入，不替代操作系统签名或安全背书。

*注：当前版本的应用安装包生命周期管理仅支持 macOS (arm64) 与 Windows (x86_64)，其他平台的安装包生命周期及各平台的常规 App 修复通道暂未开放。提交上架前，请参阅 [App Tools 发布说明](https://github.com/nimiplatform/nimi/tree/main/app-tools#canonical-release-boundary)。*

---

## 查阅参考手册

- **[SDK 接口文档](/zh/sdk/)** 与 **[SDK 设计边界](/zh/sdk/boundaries)**：公开 API 规范、客户端约定与边界准则。
- **[Runtime 架构设计](/zh/runtime/)**：底层模型调度、会话生命周期与受保护访问机制。
- **[平台核心架构](/zh/platform/)** 与 **[专业术语表](/zh/reference/glossary)**：Nimi 的核心设计理念与权威术语定义。

想直接下载体验 Nimi 桌面客户端？请访问 [Nimi 官网](https://nimi.ai) 与 [下载页面](https://nimi.ai/download)。

---

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`nimi-coding/README.zh-CN.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.zh-CN.md)
