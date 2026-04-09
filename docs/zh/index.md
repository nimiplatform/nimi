---
layout: home

hero:
  name: Nimi
  text: 开源 AI 运行时
  tagline: "极速开发阶段 — 一个运行时，统一本地与云端 AI。直接使用，基于它开发，或对它进行扩展。"
  actions:
    - theme: brand
      text: 开始使用 Nimi
      link: /zh/user/
    - theme: alt
      text: 构建应用
      link: /zh/app-dev/
    - theme: alt
      text: 构建 Mod
      link: /zh/mod-dev/
    - theme: alt
      text: GitHub
      link: https://github.com/nimiplatform/nimi

features:
  - title: 安装即用
    details: 安装 Nimi，启动运行时，通过 CLI 使用本地或云端模型生成内容。无需编写代码。
    link: /zh/user/install
    linkText: 快速上手
  - title: 本地与云端，统一接口
    details: 本地默认使用内置模型。云端通过 --provider 或 --cloud 切换。命令相同，运行时相同。
    link: /zh/user/providers
    linkText: 配置 Provider
  - title: 面向应用的 SDK
    details: "推荐入口是 @nimiplatform/sdk 的 createPlatformClient()，从同一个根包获得 typed runtime 与 realm 能力。"
    link: /zh/app-dev/
    linkText: 开始开发
  - title: Nimi Coding
    details: 面向 AI 可读的权威治理体系，以及正式 execution system 的 overview，涵盖 contracts、validators、CLI 与 execution workflows。
    link: /zh/nimi-coding
    linkText: 了解系统
---

::: warning 极速开发阶段
Nimi 目前仍处于极速开发阶段。合约、CLI 流程与桌面端能力都可能在版本之间快速调整。

请以 [Spec Map](/zh/architecture/spec-map) 和 [GitHub 上的 `spec/`](https://github.com/nimiplatform/nimi/tree/main/spec) 作为规范真源。`spec/future/` 代表结构化 backlog，不代表发布承诺。
:::
