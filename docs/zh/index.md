---
layout: home

hero:
  name: Nimi
  text: 开发者文档
  tagline: 构建 Nimi App，通过 SDK 与 Runtime 接入本地或云端 AI 能力。
  actions:
    - theme: brand
      text: 快速创建 App
      link: /zh/start/create-an-app
    - theme: alt
      text: SDK 开发指南
      link: /zh/sdk/

features:
  - title: 快速搭建与运行
    details: 检查开发前置依赖、初始化项目骨架，并在 Nimi Home 中启动与调试应用。
    link: /zh/start/
  - title: 接入 AI 能力
    details: 使用强类型 SDK 声明能力偏好，调用端侧或云端模型执行推理。
    link: /zh/sdk/first-ai-call
  - title: 常见排错与诊断
    details: 提供清晰的分步排查指引，覆盖工程搭建、Runtime 接入与 AI 调用异常。
    link: /zh/start/troubleshooting
---

你可以从[快速创建 Nimi App](/zh/start/create-an-app)开始，逐步为应用接入所需能力。[SDK 开发指南](/zh/sdk/)与 [Runtime 运行架构](/zh/runtime/)提供了完整的 API 规范、配置参考与运行模型说明。

若你希望直接下载并体验 Nimi 桌面客户端，请访问 [Nimi 官网](https://nimi.ai) 或前往[客户端下载](https://nimi.ai/download)页面。运行 Nimi Home 需要登录 Nimi 账号，登录验证将在浏览器中安全完成。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
