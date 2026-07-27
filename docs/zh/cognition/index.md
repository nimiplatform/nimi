# Cognition

## 状态：现在 (Running today)

Cognition 是独立权威域 (C-COG-*)；Runtime 桥接是已准入的消费接口。

Cognition 拥有记忆、知识、提示词服务、引用、完成关卡、技能服务、Runtime 桥接行为以及能力升级，是一个独立的权威域。

Runtime 通过明确定义的桥接面与 Cognition 通信。它能消费 Cognition，但不会吞掉 Cognition 的权威。

## 为什么 Cognition 单独成域

长生命周期的 AI 系统不止有零散的模型调用。它需要跨会话的记忆、知识检索、提示词服务、引用、完成关卡，以及能力升级路径。这些关注点足够大，需要自己的权威家。

把 Cognition 单独成域，避免 Runtime 或 Realm 被本不该归它们的记忆与知识语义压垮。同时也让桥接显式：Runtime 在确定的契约下消费 Cognition，而不是把 Cognition 吃下去。

## Cognition 拥有什么

Cognition 拥有：

- 记忆服务契约：长生命周期的参与者记忆；
- 知识服务契约：可检索的结构化信息；
- 提示词服务：权威的提示词模板与服务通道；
- 引用与完成关卡；
- Runtime 桥接契约：Runtime 消费 Cognition 的方式；
- Runtime 升级契约：能力升级如何在不重定义权威的前提下推进。

## Cognition 不拥有什么

Cognition 不拥有 Runtime 执行、Realm 的世界真相、桌面端 Shell，也不拥有 Avatar 呈现。它只暴露一个独立面，Runtime 通过桥接消费——是消费，不是吞并。

## 场景：Agent 跨会话认出用户

某个 Agent 第一天接待了一位用户，第二天用户回来了。按 Cognition 契约：

1. Cognition 的记忆服务在准入的 bank 作用域下保存了相关记忆。
2. 新会话启动时，Runtime 通过准入桥接调用 Cognition，检索相关记忆。
3. Cognition 在桥接契约下返回记忆，Runtime 直接消费，不重定义"记忆是什么"。
4. Agent 在新会话中的行为，由 Runtime 拥有的 Agent 参与契约结合这条记忆塑造。

跨域编排是有边界的。没有任何表面会发明一份 Cognition 不知道的记忆，也没有表面会因为桥接而失去自己的身份。

## 场景：知识支撑下的一次完成

某个 Agent 在完成一次回合之前需要查可检索知识。按 Cognition 的知识服务：

1. 在它的准入契约下查询知识服务。
2. 检索到的知识作为输入证据参与本次完成。
3. 完成契约决定结果可以以何种方式被使用。
4. Runtime 桥接保持 Runtime 的执行角色与 Cognition 的知识权威清晰分开。

如果结果错了是因为知识过期，修复在 Cognition；如果结果错了是因为完成关卡治理不够，修复在完成契约，而不是知识服务。

## 来源依据

- [`.nimi/spec/cognition/standalone-services.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/standalone-services.authority.yaml)
- [`docs/spec/cognition-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/cognition-domain-index.md)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
