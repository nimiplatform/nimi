# 愿景

Nimi 的出发点是一个简单的想法：你的 AI 应该是你个人的。它在你身边运
行，记住对你重要的东西，听你的，而不是听某个拥有它的平台的。

所以 Nimi 是本地优先的。它是你装在自己机器上的软件，与你对话的 AI 在你
的设备上运行，用你选择的模型，本地或云端都可以。你的角色和世界无论到
哪里都保持自己的身份。系统里也没有哪个部分会悄悄变成其他一切的主人：
角色是谁、它怎么运行、它在屏幕上是什么样子，是三件分开的事，各有明确
的归宿。

对用户来说，这些加在一起，是一个真正感觉属于自己的 AI。对开发者来说，
这是一套稳定、可以安心在其上构建的边界。

## 持久身份，本地执行

你与之对话的角色，是由 Realm 保存的持久身份：无论你走进哪个世界，它都
是同一个角色。开始对话时，Runtime 根据 Realm 提供的角色描述，把角色在
你机器上运行成一个 LocalAgent。一个角色可以支撑许多本地 AI 体验，每个
LocalAgent 都保持自己的运行状态。

## 用户控制的访问

App 通过 SDK 以强类型方式提出请求。Runtime 根据你当前的登录会话判断你
是谁、哪个 App 在请求、它被允许做什么。App 不会持有你的 Realm 凭证、模
型服务商密钥，或任何 Runtime 内部凭据。

## 可互操作投影

对话、记忆、知识、语音和呈现都由 Runtime 掌管。其他产品只能拿到有限、
强类型的视图，仅此而已。Avatar 可以把角色在屏幕上呈现得很丰富，但它不
会因此接管背后的 LocalAgent。

## 渐进式平台增长

今天运行的产品闭环，不依赖通用 Workflow、MCP、World Evolution、
Marketplace、公共分发或商业结算。新能力以后可以在各自的边界内加入，不
需要重新定义「角色运行成 LocalAgent」这个核心模型。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
