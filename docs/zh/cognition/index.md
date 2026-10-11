# Cognition 长期记忆架构

Cognition 是 Nimi 智能体长期记忆 (Long-term Memory) 的核心托管中枢。当智能体能够跨越对话记住你的称呼、日常习惯、技术偏好或过往经历时，这些持久化认知便由 Cognition 在底层提供支撑。

Cognition 在平台中是自治的所有权域：Runtime 负责调度并执行具体的对话会话，Cognition 负责提炼并沉淀具有长期价值的信息。两者通过强类型的 Runtime-Bridge 协议保持清晰的解耦与安全交互，职责分明、互不越权。

## 核心设计特性与用户体验

- **跨会话的记忆连续性**：Agent 具备持久化的记忆能力。即使关闭 App、数日后再重新打开，同一个 Agent 依然了解你过往告知的事实。记忆直接锚定于 Agent 实体本身，而非单一的对话窗口或特定虚拟世界。
- **Agent 维度的严格隔离**：记忆库以 Agent 为单位进行严格的数据隔离。同一用户账号下的多个 Agent 拥有各自独立的记忆空间，彼此无法互相越权检索，平台绝不会构建暗中打通的全账号共享画像。
- **受控的手动纠错机制**：用户可通过受授权的记忆管理界面直接更正已保存的记忆。在管理面板中选中条目并提交修正内容后，系统在底层原子化提交，修正后的事实才会作为当前有效版本对外生效。
- **明确确认的逻辑遗忘**：用户可明确指定并确认遗忘特定记忆。Cognition 提交成功后，遗忘屏障 (Forget Barrier) 会确保该条记忆不再被召回，后续的系统重启、重试、向量索引重建或事件回放均无法恢复该记忆的召回。原始对话记录与 Realm 角色设定保持不变。在常规聊天窗口随口要求“忘记”，不替代此项管理操作。
- **隐私与凭据过滤**：敏感信息被严格过滤。密码、API Token、私密凭证以及明确带有“不要记录”意图的内容，在写入记忆库前即被拦截过滤。
- **清晰透明的记忆溯源**：每条沉淀的记忆均清晰标注来源类型：是来自用户的主动陈述、基于上下文的合理推断，还是从多条旧记忆提炼整合所得。

记忆检索具备高度的容错性：若本地向量索引正在后台重建、或检索因故暂时不可用，对话仍会平稳正常推进，仅当前轮次不附加过往记忆；读取维度的暂时波动绝不会阻塞核心对话，更不会凭空伪造虚假记忆。而写入与遗忘则受到强事务保障：只有在 Cognition 成功持久化落盘后，操作才被确认完成。

## Cognition 的所有权范畴

- **每个 Agent 的独立记忆库 (Memory Bank)**：不透明、按 Agent 严格物理隔离的逻辑存储单元，仅绑定对应 Agent 实例。它不是公开的全局账号画像，外部 App 无法绕过安全网关直接查询。
- **记忆的权威状态与生命周期流转**：涵盖记忆准入甄别、来源标记、版本纠错与取代、遗忘屏障持久化及安全删除。
- **V1 核心处理管线**：包含 Remember 提炼管线、全文检索召回管线、向量语义召回管线、确定性精确 Forget 遗忘管线，以及轻量静态操作路由。
- **派生检索索引（全文与向量）**：基于权威记忆库衍生出的辅助查询索引；索引可随时从零重建，不充当数据权威。
- **受约束的 Agent 资源通道**：来自 Runtime 快照的强类型数据源单元，同样遵循 Agent 级隔离，用于辅助上下文构建。

> [!NOTE]
> 长期知识体系 (Knowledge) 在架构归属上也属于 Cognition，但在当前的 V1 阶段尚未对外开放公开调用路径，记忆数据亦不会未经确认自动升级为共享知识。

## Runtime 与 Realm 的职责分工

- **Runtime 掌管执行生命周期**：管理 LocalAgent 身份、权限鉴权、对话会话与事件提交、上下文组装编排、AI 推理执行，以及每轮回合的最终提交。Runtime 必须先完成权限判定，记忆交互请求方可跨越 Bridge 网关；Cognition 仅接受来自受信任 Runtime 的安全调用。
- **Realm 掌管世界权威状态**：关于在某个虚拟世界中发生过什么的记忆，仅属于该智能体的个体认知，绝不能反向篡改该世界的状态机或公共历史记录。
- **SDK 与应用的安全边界**：外部 App 与 SDK 无法直接向 Cognition 发送裸请求，它们消费的记忆内容均作为 Runtime 规范返回的有界结果对外呈现。

## 典型场景：跨会话记忆

周一你告知 Agent 自己对坚果过敏，随后关闭了应用；周五你在新会话中让其推荐零食：

1. **周一写入**：Runtime 将用户的过敏信息作为对话事件，经 Bridge 提交给 Cognition。
2. **提炼与沉淀**：Cognition 的 Remember 管线判定该事实具有长期保留价值，Cognition Core 原子化持久化该条目，来源标注为“用户主动陈述”。
3. **周五召回**：Runtime 在规划当前轮次的上下文时向 Cognition 发起语义召回，Cognition 命中并返回坚果过敏的记忆。
4. **上下文注入**：Runtime 将过敏偏好融入提示词上下文，推荐的零食选项自然规避坚果。

若周五召回时索引恰在后台重建，系统将安全返回“记忆暂不可用”，本轮回话正常推进，绝不会产生死锁卡顿。

## 典型场景：主动纠错与遗忘

假设之前保存的一条记忆记录你在 A 公司就职，而你近期已跳槽至 B 公司：

1. **进入管理界面**：打开该 Agent 专属的已授权记忆管理面板，查看已保存的记忆列表。
2. **提交更正请求**：选中旧记忆条目，提交其 `memoryId` 与更正后的事实内容。Runtime 在校验操作者的管理权限 (`agent.configure`) 后，将指令转发至 Cognition。
3. **原子生效**：Cognition 成功落盘后，新事实成为当前有效版本，被取代的旧记录退出默认召回视图。
4. **明确确认遗忘**：若不希望再召回旧工作的相关事实，可选中对应条目并执行显式确认的 Forget 操作。SDK 请求携带条目 ID 并标记 `confirmed: true`，持久化遗忘屏障一旦生效，后续即使重建索引或重放事件，该条目均不再参与召回。（原始聊天历史记录与角色基础设定保持不变。）

在日常聊天窗口中随意说“我离开 A 公司了”或“忘掉我前公司的事情”，仅属于普通对话文本，不会直接触发底层的结构化管理操作；管理级修改必须在受权的管理界面中明确执行。

每个记忆库均属于该 Agent 独享，你在该 Agent 身上修正的记忆，绝不会干扰到你与其它独立 Agent 之间的交流。

## Source Basis

- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
- [`nimi-cognition/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-cognition/README.md)
- [`sdks/typescript/core/app/local-app-runtime-platform-configure.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-configure.ts)
