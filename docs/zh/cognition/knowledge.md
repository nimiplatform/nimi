# 知识服务

Cognition 知识服务是 Agent 推理的类型化知识面 — 带一等关系的页、词项与混合检索、ingest 生命周期。它跟 runtime 知识 bank 不同；这是独立权威的知识面。

## 知识服务拥有什么

| 关注 | 表面 |
| --- | --- |
| 类型化页生命周期 | Save / list / load / delete |
| 词项检索 | 关键字 / 短语搜索 |
| 混合检索 | 词项 + 向量 |
| 一等关系 | 页之间的类型化关系图 |
| Ingest 生命周期 | `queued → running → completed/failed` |
| 页元数据 | 服务派生 |

页是类型化的。关系图是**一等的** — 你可以查询「跟这页连着的有什么」拿到类型化图结果，不是平铺列表。

## 一等关系

| 性质 | 值 |
| --- | --- |
| 存储 | 类型化关系图 |
| 基数 | 按关系类型化 |
| 跨 scope | 禁止（cognition scope 绑定） |
| 修改 | 通过准入关系合同 |
| 查询 | 「跟 X 连着的有什么」返回类型化图 |

这就是把 Cognition 知识跟扁平搜索索引区分开的地方。读者（或 Agent）能游走关系图；推理能遍历「什么派生自什么」。

## Ingest 生命周期

| 状态 | 含义 |
| --- | --- |
| `queued` | 等待 ingest |
| `running` | Ingest 进行中 |
| `completed` | Ingest 成功 |
| `failed` | Ingest 失败；原因被记下 |

被打断的本地任务变成**重开后的显式失败状态证据**。平台**不**静默丢 ingest 进度；重开时失败可见。

## 阅读场景：Agent 用词项搜索查知识

某 Agent 在某轮次需要回忆某个主题的信息。

1. **词项搜索。** Agent 在 `KnowledgeService.Search` 下发查询。
2. **服务返回匹配。** 匹配查询的页，带服务派生相关性元数据。
3. **Agent 用结果。** Brain 层用回忆的知识组合响应。

Agent **不**自己扫描所有页；服务提供类型化搜索面。

## 阅读场景：Agent 沿关系图导航

某 Agent 有页「明天面试」。相关页可能是「用户偏好谈话点」「用户职业目标」「用户焦虑触发条件」。

1. **从锚页导航。** Agent 调 `KnowledgeService.RelatedPages(pageId)`。
2. **服务返回类型化图。** 连着的页带类型化关系种类。
3. **Agent 遍历。** 推理纳入相关上下文。
4. **组合响应。** 反映 Agent 更广的理解。

一等关系让结构化推理成为可能。扁平搜索索引**无法**回答「跟这个连着的是什么」。

## 阅读场景：Ingest pipeline 中途失败

某用户 ingest 一大组文档；一半时进程被打断。

1. **Ingest 启动。** 状态 `queued → running`。
2. **进程被杀。** 外部打断。
3. **重开时。** Ingest 状态检测出 `failed`（或带过时心跳的 `running` 超时到 `failed`）。
4. **失败可见。** 用户看到带原因的类型化失败 — 不是静默部分完成。
5. **恢复 / 重启。** 用户可以在准入恢复合同下恢复，或重启 ingest。

平台让打断可见。静默部分完成会让过时状态冒充完成。

## 知识清理

知识页跟记忆记录一样，有 digest 清理资格。

| 清理驱动 | 清理什么 |
| --- | --- |
| Digest | 断引用 / 过时 support 的页 |
| 显式删 | 用户驱动的破坏性删 |
| 归档 | 可逆归档（digest 第一 pass） |

清理可追溯到 refgraph 推理。因断引用被归档的页拿断引用作为解释。

## Cognition Scope 与知识

知识页住在 Cognition scope 里。跨 scope 引用被禁。这意味着一个 Agent scope 里的知识**不**漏到另一个里。

## 边界总结

| 关注 | 拥有者 |
| --- | --- |
| 页存储 | Cognition 知识服务 |
| 关系图 | Cognition（一等） |
| 搜索 | 词项 / 混合检索 |
| Ingest | 类型化生命周期 |
| 清理 | Digest + 显式删 |

## 知识服务**不**做什么

| 关注 | 为什么不 |
| --- | --- |
| 修改 kernel | Kernel 是核心真相；建议**不能**降权 |
| 跨 scope 引用 | 硬拒 |
| 自由格式无结构 ingest | 页是类型化的 |
| 隐式相关性 | 服务派生元数据是显式的 |

## 来源

- [`.nimi/spec/cognition/kernel/knowledge-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/knowledge-service-contract.md)
- [`.nimi/spec/cognition/kernel/family-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/family-contract.md)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/tables/knowledge-service-operations.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/knowledge-service-operations.yaml)
- [`.nimi/spec/cognition/kernel/reference-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/reference-contract.md)
