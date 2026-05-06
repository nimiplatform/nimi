# Cognition

Cognition 是记忆、知识、Prompt 服务、引用、补全、技能服务、Runtime 桥接行为和能力升级的**独立权威域**。

Runtime 可以接桥到 Cognition。它**不**吸收 Cognition 的权威。

## Cognition 为什么独立

长期 AI 系统需要的远不止短暂的 Model 调用。它需要跨会话的记忆、知识检索、Prompt 服务、引用、补全闸口和升级路径。这些关注涉及面足够广，需要自己独立的权威家。

把 Cognition 切出来防止 Runtime 或 Realm 被记忆与知识语义压垮，也让桥接显式：Runtime 在已定义合同下消费 Cognition，而不是吸收它。

## Cognition 拥有什么

Cognition 拥有：

- 记忆服务合同（参与者的长期记忆）；
- 知识服务合同（可检索的结构化信息）；
- Prompt 服务（权威 Prompt 模板与服务通道）；
- 引用与补全闸口；
- Runtime 桥接合同（Runtime 怎样消费 Cognition）；
- Runtime 升级合同（能力升级如何流动而不重新定义权威）。

## Cognition 不拥有什么

Cognition 不拥有 Runtime 执行、Realm 世界真相、桌面端外壳或 Avatar 呈现。它暴露的是一个独立面，Runtime 可以接桥；这种**桥接是消费，不是吸收**。

## 阅读场景：Agent 跨会话记得用户

设想一个 Agent 第一天遇见某用户，第二天用户回来。在 Cognition 合同下：

1. Cognition 的记忆服务在已认可的 bank scope 下持有相关记忆。
2. 新会话开始时，Runtime 通过已认可桥调用 Cognition 解析相关记忆。
3. Cognition 在桥合同下返回记忆；Runtime 消费它而不重新定义「记忆是什么」。
4. Agent 在新会话里的行为受这些记忆塑造，走 Runtime-owned Agent 参与合同。

跨域协奏被有界。没有任何面板发明 Cognition 之外的记忆；也没有任何面板因为这次桥接就停止做自己。

## 阅读场景：知识背书的补全

设想一个 Agent 在完成一轮对话前，需要查阅可检索的知识。在 Cognition 知识服务下：

1. 知识服务在已认可合同下被查询。
2. 检索到的知识作为输入证据参与补全。
3. 补全合同决定结果允许如何被使用。
4. Runtime 桥让 Runtime 的执行角色与 Cognition 的知识权威角色保持干净分离。

如果结果错了是因为知识陈旧，修复点在 Cognition，不在 Runtime；如果结果错了是因为补全治理不严，修复点在补全合同，不在知识服务。

## 来源

- [`.nimi/spec/cognition/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/index.md)
- [`.nimi/spec/cognition/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/index.md)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/family-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/family-contract.md)
- [`.nimi/spec/cognition/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/surface-contract.md)
- [`.nimi/spec/cognition/kernel/memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/memory-service-contract.md)
- [`.nimi/spec/cognition/kernel/knowledge-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/knowledge-service-contract.md)
- [`.nimi/spec/cognition/kernel/prompt-serving-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/prompt-serving-contract.md)
- [`.nimi/spec/cognition/kernel/completion-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/completion-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-upgrade-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-upgrade-contract.md)
