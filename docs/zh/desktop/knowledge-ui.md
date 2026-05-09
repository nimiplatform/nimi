# 知识界面

## 状态：已准入，正在构建中

桌面知识界面契约 (`desktop/kernel/knowledge-ui-contract.md`) 已在内核级别获得准入。面向用户的浏览和管理界面正处于积极构建中。

## 该界面是什么

桌面知识界面是用于浏览和管理认知知识库的**用户界面**——包括列出、搜索、添加条目、组织和归档。

它是认知知识服务（参见 [Cognition → Memory + Knowledge Composition](/cognition/memory-knowledge-composition)）的消费者，而不是其所有者。

## 边界

| 拥有 | 不拥有 |
| --- | --- |
| 面向用户的浏览和管理用户体验 | 知识服务契约（认知） |
| 每个知识库的界面范围 | 跨库授权（认知） |
| 管理流程界面 | 管理准入规则（认知） |

该界面通过已准入的运行时桥接来消费知识服务。它不自行发明知识结构。

## 用户场景：用户添加一个知识条目

1. **用户在界面中打开知识库。** 每个库的范围得到尊重。
2. **用户添加条目。** 管理界面捕获内容和元数据。
3. **通过已准入的流程提交。** 认知知识服务根据其契约接受该条目。
4. **未来的代理检索将看到新条目。**

## 用户场景：用户归档一个条目

1. **用户选择归档。** 桌面界面请求认知知识服务进行归档。
2. **系统查询参考图阻塞器。** 如果该条目有强引用关系，归档可能会因可解释性而被阻止（参见 [Reference Graph](/cognition/reference-graph)）。
3. **用户决定。** 要么先解决依赖项，要么接受断开依赖关系的证据。
4. **归档完成。** 根据认知清理语义。

## 知识界面不做的事情

- 它不拥有知识服务的语义。
- 它不允许界面自行创建绕过认知的检索界面。
- 它不允许未经管理准入的条目进入。
- 它不允许在归档或删除时绕过参考图阻塞器。

## 来源依据

- [`.nimi/spec/desktop/kernel/knowledge-ui-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/knowledge-ui-contract.md)
- [`.nimi/spec/cognition/kernel/knowledge-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/knowledge-service-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)