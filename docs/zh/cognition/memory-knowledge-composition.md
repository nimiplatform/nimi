# 记忆 + 知识组合

> 状态：运行中 (Running)。认知的 `MemoryService` 和 `KnowledgeService` 通过 `C-COG-*` 提供；运行时桥接合约是已准入的消费路径。

认知包含**两个不同的服务**，它们共同承载了代理对用户和事实的持续理解。从远处看它们可能很相似，但在底层行为上却大不相同。

| 服务 | 承载内容 | 连续性 | 更新方式 |
| --- | --- | --- | --- |
| 记忆 | “我对参与者的记忆”——关系连续性 | 每个代理 + 每个参与者范围 | 代理的行为 + 已准入的记忆写入路径 |
| 知识 | “我可以检索的事实”——结构化信息 | 每个知识库范围 | 策划流程 + 摄取路径 |

混淆这两个服务会导致不良的代理行为：应该存储在记忆中的关系事实会被分散到知识库中（脆弱且无范围限制）；应该存储在知识库中的事实会被嵌入到记忆中（高变动率，低检索质量）。

## 记忆：关于参与者的连续性

| 属性 | 值 |
| --- | --- |
| 权威 | `cognition/kernel/memory-service-contract.md` |
| 范围 | 每个代理 + 每个参与者（已准入的银行范围：`AGENT_CORE`、`AGENT_DYADIC` 等） |
| 变更 | 通过已准入的记忆写入路径 |
| 检索 | 通过认知的提示通道和桥接表面 |
| 隐私 | 双方记忆不会跨参与者共享 |

记忆承载了代理与一个人的关系历史：偏好、之前的对话、约定的惯例、正在进行的主题。银行范围是隐私和隔离的基本单位。

## 知识：可检索的事实

| 属性 | 值 |
| --- | --- |
| 权威 | `cognition/kernel/knowledge-service-contract.md` |
| 范围 | 每个知识库 |
| 变更 | 通过策划/摄取（不是来自单次对话） |
| 检索 | 通过结构化的检索表面 |
| 隐私 | 每个知识库授权 |

知识承载了代理可以查找的事实：文档、常见问题解答、特定领域的参考。知识**不是**记录特定参与者所说内容的地方。

## 为什么分离很重要

如果记忆吸收了知识：
- 每个参与者都会携带相同的事实副本
- 策划流程需要更新 N 个副本
- 跨参与者的事实更新会无声地漂移

如果知识吸收了记忆：
- 隐私边界将崩溃（一个参与者的记忆在一个共享的知识库中 = 泄露）
- 记忆的每个关系的保真度会简化为“知识库恰好所说的内容”

认知同时保留两者。应用程序通过已准入的表面来消费这两者；它们不会发明第三种融合它们的东西。

## 运行时如何消费认知

运行时是执行权威。认知是认知权威。运行时桥接合约 (`cognition/kernel/runtime-bridge-contract.md`) 定义了运行时可以消费的内容：

| 桥接表面 | 所有者 | 用途 |
| --- | --- | --- |
| 记忆消费 | 认知 | 运行时在回合组装时请求相关记忆 |
| 知识消费 | 认知 | 运行时在回合组装时请求相关知识 |
| 提示服务 | 认知 | 认知在已准入的通道下组装提示 |
| 引用图 | 认知 | 认知解释为什么某个工件相关 |

桥接是**消费**，而不是吸收。运行时不能重新定义记忆银行是什么或知识是如何策划的。认知不依赖于运行时来成为自己。

## 读者场景：代理回忆用户

用户第二天回来与他们的代理交谈。

1. **回合到达。** 运行时收到 `(agent_id, conversation_anchor_id)` 的回合。
2. **运行时调用认知桥接以获取记忆。** 请求在代理 + 参与者银行范围内 (`AGENT_DYADIC` + `AGENT_CORE` 根据已准入策略) 的相关记忆。
3. **认知返回记忆。** 由银行范围和提示通道分离规则限定。
4. **运行时调用认知桥接以获取知识。** 如果回合需要事实（例如，代理有一个绑定到其配置文件的知识库），则询问知识服务。
5. **知识返回匹配的事实。** 通过已准入的检索表面。
6. **运行时组装回合。** 记忆 + 知识在已准入的提示通道分离下参与提示服务。
7. **代理响应。** 回合生命周期按照 `runtime-agent-service-contract.md` 进行。

两个服务都参与了。没有一个吸收另一个。运行时通过桥接消费了两者；运行时没有重新定义任何一个。

## 读者场景：回合后的记忆写入

回合完成后，代理的行为可能会允许一次记忆写入。

1. **记忆写入选项出现。** 根据代理的已准入记忆写入规则。
2. **认知准入。** 写入在已准入的银行范围内 (`AGENT_DYADIC` 对于此参与者) 进入记忆。
3. **其他参与者不受影响。** 跨参与者范围得到尊重；写入对其他参与者的双方记忆不可见。

## 读者场景：知识策划更新

维护者更新了一个许多代理使用的知识库中的事实。

1. **策划流程更新。** 知识库条目被更新。
2. **未来的检索看到新事实。** 下次代理查询此知识库时，他们检索到更新的事实。
3. **记忆不变。** 过去的每个参与者的记忆快照不会被无声地重写。如果记忆引用了旧事实，引用图（参见 [引用图](/cognition/reference-graph)）显示了关系；清理决策是明确的。

边界保持“知识改变”不会无声地改变“这个用户曾经说过什么”。

## 此组合不做的事情

- 它不允许运行时吸收认知。
- 它不允许记忆吸收知识或反之亦然。
- 它不允许应用程序代码跳过桥接直接消费。
- 它不允许通过共享知识库导致跨参与者的记忆泄露。

## 边界总结

| 关注点 | 所有者 |
| --- | --- |
| 独立的认知权威 | `cognition/kernel/cognition-contract.md` (`C-COG-*`) |
| 记忆服务真相 | `memory-service-contract.md` |
| 知识服务真相 | `knowledge-service-contract.md` |
| 运行时消费桥接 | `runtime-bridge-contract.md` |
| 提示服务（带通道分离） | `prompt-serving-contract.md`（参见 [提示通道](/cognition/prompt-lanes)） |

## 来源依据

- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/memory-service-contract.md)
- [`.nimi/spec/cognition/kernel/knowledge-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/knowledge-service-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
- [`.nimi/spec/cognition/kernel/prompt-serving-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/prompt-serving-contract.md)