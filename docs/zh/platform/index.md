# 平台

Nimi 是一个装在本地、开源、本地优先的个人 AI 产品。在 Nimi 里，你会遇到
角色、展开对话、做出创作、追故事、逛世界。这些体验从你自己的机器开始，
也始终属于你。

Nimi Home 是入口，今天由桌面端承载；它负责呈现体验，并不替代背后的任何
部分。在它后面，有几个部分一起工作：

- Realm 保存生态里的身份：你的角色、好友和世界，以及世界里公认的事实。
- Runtime 是 AI 引擎。它把角色在本地运行成 LocalAgent，驱动多家 Provider
  的本地模型和云端模型。
- SDK 是 App 与 Runtime、Realm 打交道的统一强类型接口。
- Avatar 把角色呈现在屏幕上，负责它的样子、动作和反应，但不运行背后的
  AI。
- Kit 提供共享 UI 部件，产品界面真正需要时才用。

这些部分被有意分开。知道你的角色是谁的那部分，不必是运行 AI 或把它画
上屏幕的那部分。正因如此，同一个角色在哪里都是它自己。

## Character 与 LocalAgent

你在 Realm 里创建或选择一个角色。Realm 签发一份 Character Source，也就
是 Runtime 用来把角色运行成 LocalAgent 的描述；这个 LocalAgent 的范围限
定在你身上。LocalAgent 可以利用 Realm 分享出来的世界上下文，但不会接管
角色的身份或世界的事实，那些始终留在 Realm。

App 通过 SDK 使用 LocalAgent 的能力。Runtime 根据当前会话判断身份与授
权，所以 App 拿不到 Realm 凭证、Runtime 内部凭据、Provider 密钥，也拿
不到账号级 LocalAgent 全量清单。

参见 [Character 与 LocalAgent](/zh/platform/agents/) 以及
[Realm 与 Runtime 是同侪](/zh/platform/architecture/realm-runtime-siblings)。

## 六项协议基础

六项协议基础描述产品之间可以互相传递的操作，任何一方都不会因此接管另
一方的事实：

- State
- Event
- Intent
- Action
- Audit
- Permission

参见 [协议](/zh/platform/protocol) 与
[执行协议](/zh/platform/execution-protocol)。

## 当前边界

今天的产品闭环是 Realm、Runtime、SDK、Nimi Home 和 App。通用 Workflow、
MCP、World Evolution、Marketplace、Registry、Trust Tier、公共分发和商
业结算都不是这个闭环的前置条件。面向未来的分发设计保持隔离，除非与这
些边界冲突。

Simulator 是给选定 App 模块用的开发与验证工具。它不是当前的产品平台，
也替代不了产品宿主。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
