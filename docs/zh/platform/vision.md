# 愿景

Nimi 是开放世界平台。持久 Character 与本地执行的 AI 可以参与其中，同时
identity、execution 与 presentation 不会被压成一个 owner。

## 持久身份，本地执行

Realm 持有跨 World 参与的 Character。Runtime 从 Realm 签发的 Character
Source 物化有明确 owner 的 LocalAgent。同一 Character source 可以支持本地
AI 体验，而每个 LocalAgent 仍保持独立运行态状态。

## 用户控制的访问

App 通过 SDK 表达强类型 intent。Runtime 从 active session 推导 account、
App identity、authorization 与 LocalAgent access。App 不携带 Realm JWT、
Provider Credential 或 Runtime proof。

## 可互操作投影

Conversation、Memory、Knowledge、voice 与 presentation 都留在 Runtime，只以
已授权、强类型投影进入产品。Avatar 与其他 surface 可以实现丰富渲染，但不会
接管 LocalAgent 真相。

## 渐进式平台增长

当前产品闭环不依赖通用 Workflow、MCP、World Evolution、Marketplace、公共
分发或商业结算。未来能力可以在自己的 owner 边界后加入，而无需重新定义核心
Character–LocalAgent 模型。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
