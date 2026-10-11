---
layout: home

hero:
  name: Nimi
  text: 开发者文档
  tagline: 构建现代化 Nimi App，通过 SDK 无缝集成端侧与云端 AI 能力，探索跨世界的连续性生态。
  actions:
    - theme: brand
      text: 快速创建 App
      link: /zh/start/create-an-app
    - theme: alt
      text: SDK 开发指南
      link: /zh/sdk/

features:
  - title: 快速搭建与运行
    details: 环境检查、一键初始化工程，并在 Nimi Home 中实时预览与调试。
    link: /zh/start/
  - title: 接入 AI 能力
    details: 使用强类型 SDK 声明能力偏好，高效调用本地模型或云端多模态推理。
    link: /zh/sdk/first-ai-call
  - title: 常见排错与诊断
    details: 覆盖开发环境、依赖就绪、网络通信与 AI 调用的标准化排查指引。
    link: /zh/start/troubleshooting
---

推荐从[快速创建 Nimi App](/zh/start/create-an-app)开始，为你的应用接入所需能力。[SDK 开发指南](/zh/sdk/)和 [Runtime 运行架构](/zh/runtime/)提供了详尽的 API 文档、配置参数与执行模型说明。

若你希望直接下载并体验 Nimi 桌面客户端，请访问 [Nimi 官网](https://nimi.ai) 并查看[客户端下载](https://nimi.ai/download)。Nimi Home 需要登录 Nimi 账号，并在浏览器中完成授权验证。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
