# Cognition 长期记忆架构

Cognition 是 Nimi 智能体长期记忆（Long-term Memory）的托管域。当智能体开启长期记忆后，经过提炼准入并成功保存的事实（如你的称呼、日常偏好或过往讨论的话题）即可由 Cognition 在跨会话间提供持久化存储与召回。

Cognition 在平台中是自治的所有权域：Runtime 负责调度和执行对话，Cognition 负责提炼、存储与检索长期记忆。两者通过强类型的 Runtime-Bridge 协议交互，边界清晰、职责独立。

## 核心设计特性与用户体验

- **跨会话的记忆连续性**：在为 Agent 启用长期记忆的前提下，经过提炼与准入判定的事实会持久化并绑定到 Agent 实体，而非局限在单个聊天窗口或特定虚拟世界。日常对话并非说出一句话就必然永久记住或每次都被召回——具体事实需先通过 Remember 管线准入并落盘，后续能否召回还取决于当轮检索相关性与服务可用性。
- **Agent 维度的严格隔离**：记忆库按 Agent 严格隔离。同一用户下的多个 Agent 拥有各自独立的记忆空间，无法互相检索，平台也不会构建跨 Agent 的全局共享账号画像。
- **受控的记忆管理与更正**：用户与应用可通过受 `agent.configure` 授权保护的 SDK `agentConfigure.memory`（提供 `inspect`、`correct`、`forget`、`setEnabled`、`deleteAll`）及 Kit 的 `AgentCenterCognitionSection` 界面查看、启停、清空或更正记忆。对某条记忆提交更正后，Cognition 会原子化写入新内容并将该旧条目置为已取代；但针对单条记忆的更正或遗忘按条目 ID 生效，不会自动删除其他语义相似的记忆条目。
- **显式确认的遗忘与屏障**：遗忘操作需显式确认（`confirmed: true`）。提交后，持久化的遗忘屏障（Forget Barrier）会阻止该条记忆在系统重启、重试、索引重建或事件回放中复活并重返召回结果。但遗忘屏障仅作用于对应记忆条目本身：不会删除原始对话记录或修改 Realm 角色设定，也不能保证模型永远不知道该事实（例如该信息仍存在于当前会话上下文、其他未删除的相似记忆或新的用户输入中）。
- **凭据过滤与 `do-not-remember` 边界**：提炼准入阶段内置了常见敏感凭据（如密码、私钥、API Token）过滤规则，并识别明确的 `do-not-remember`（不要记住）意图以拦截入库。这有助于降低敏感内容误存的风险，但并不宣称自动过滤器能做到绝对无漏判。
- **清晰的记忆溯源**：每条落盘记忆都会记录来源类型：是用户主动陈述、基于上下文推断，还是由既有记忆提炼整合而成。

记忆检索具备良好的容错性：若索引正在后台重建或检索暂时不可用，当前对话依然正常推进，仅本轮不附带相关记忆；检索波动不会阻塞对话执行，也不会捏造兜底记忆。相对地，写入、更正与遗忘遵循严格的事务一致性，仅在 Cognition 完成持久化落盘后才返回成功。

## Cognition 的所有权范畴

- **每个 Agent 的独立记忆库（Memory Bank）**：不透明、按 Agent 隔离的逻辑存储单元，仅绑定对应 Agent。它不是全局账号画像或共享工作区存储，外部 App 无法直接查询。
- **记忆的权威状态与生命周期**：涵盖提炼准入、来源标记、版本取代、遗忘屏障持久化及清空删除。
- **V1 核心处理管线**：包含 Remember 提炼管线、全文检索召回管线、向量语义召回管线、精确 Forget 遗忘管线，以及静态操作路由。
- **派生检索索引（全文与向量）**：基于权威记忆库构建的辅助检索索引；索引可随时重建，本身不充当数据权威。
- **受约束的 Agent 资源通道**：由 Runtime 快照派生的强类型数据源单元，同样按 Agent 隔离，用于辅助构建上下文。

> [!NOTE]
> 长期知识体系（Knowledge）在架构上归属 Cognition，但在 V1 阶段没有活动的公共读写路径，Agent 的记忆也不会自动升级为共享知识。

## Runtime 与 Realm 的职责分工

- **Runtime 掌管执行生命周期**：管理 LocalAgent 身份、会话鉴权、对话事件提交、上下文编排、AI 推理及回合提交。所有记忆请求跨越 Bridge 前均由 Runtime 完成权限校验，Cognition 仅接受受信任 Runtime 实例的调用。
- **Realm 掌管世界权威状态**：Agent 对虚拟世界事件的个体记忆仅属于该 Agent 自身，不会反向修改虚拟世界的状态机或公共历史。
- **SDK 与应用的安全边界**：外部 App 与 SDK 不能直接调用 Cognition，而是通过 Runtime 暴露并校验的受控接口访问记忆能力。

## 典型场景：跨会话记忆

假设你已为 Agent 开启长期记忆。周一你在聊天中提到自己喜欢喝无糖绿茶，随后关闭应用；周五你在新会话中请它推荐下午茶饮品：

1. **周一写入**：Runtime 记录该轮对话事件，并通过 Bridge 提交给 Cognition。
2. **提炼与落盘**：Cognition 的 Remember 管线评估该陈述并通过准入过滤，将其作为长期偏好原子化落盘，来源标注为“用户主动陈述”。
3. **周五召回**：Runtime 在规划新回合上下文时向 Cognition 请求相关记忆，Cognition 检索并返回喜欢无糖绿茶的记忆条目。
4. **上下文注入**：Runtime 将召回的偏好注入提示词上下文，帮助模型在推荐饮品时自然纳入这一习惯。

若周五步骤 3 时索引恰在后台重建或检索暂不可用，Cognition 会返回暂不可用状态，本轮对话将不附带相关记忆并继续正常回复。

## 典型场景：更正与确认遗忘

假设某条已保存的记忆记录你在 A 公司工作，而你近期已跳槽至 B 公司：

1. **查看已存记忆**：在具备 `agent.configure` 权限的条件下，打开 Kit 的 `AgentCenterCognitionSection` 管理界面（或通过 SDK 调用 `agentConfigure.memory.inspect`）查看该 Agent 的记忆列表。
2. **提交更正**：选中旧条目，通过 `agentConfigure.memory.correct` 提交其 `memoryId` 与更新后的文本。Runtime 校验管理句柄与 `agent.configure` 权限后，将请求转发至 Cognition。
3. **原子化生效**：Cognition 落盘成功后，新内容成为当前有效记录，被取代的旧条目退出活动召回结果。（若另有其他独立记忆条目也提到了 A 公司，不会因此被自动改写。）
4. **显式确认遗忘**：若希望彻底阻止某条记忆被召回，可选中该条目并执行带 `confirmed: true` 的 `agentConfigure.memory.forget`。遗忘屏障落盘后，即使后续重建索引或重放事件，该条目也不会再复活参与召回。原始聊天记录与 Realm 角色设定 保持不变；若当前会话上下文、其他未删除的记忆或新的用户输入中仍提及 A 公司，模型仍可能知晓该信息。

在普通聊天中说“我离开 A 公司去 B 公司了”，仍可能经过 Remember 管线提炼并写入新的长期记忆条目，但普通对话不会直接触发管理级的 `correct` 或 `forget` 接口调用。

由于记忆库按 Agent 严格隔离，对单个 Agent 记忆的更正或遗忘不会影响你与其他 Agent 的对话。

## Source Basis

- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
- [`nimi-cognition/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-cognition/README.md)
- [`sdks/typescript/core/app/local-app-runtime-platform-configure.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-configure.ts)
