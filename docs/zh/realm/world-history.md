# 世界演进历史 (World History)

世界历史 (World history) 构成了在一个世界范围内所发生一切事件的**仅限追加型规范化日志 (Append-only canonical record)**。所有记录强制要求附带溯源依据 (Provenance)。执行回放推演 (Replay runs) 不具备向该库追加数据的权限；仅有真相突变执行 (Canon-mutating runs) 被授权实施追加。对于历史缺陷的修正，必须通过记录替代 (Supersession) 或标记废止 (Invalidation) 来完成，系统**绝不容许**实施静默删除 (Silent deletion)。

## 仅限追加的防御态势 (Append-Only)

| 架构属性 | 设定规范 |
| --- | --- |
| 数据存储 | 归口于 Realm `R-WHIST-*` 核心 |
| 可变性机制 | 强制仅限追加 (Append-only) |
| 授权执行种类 | `REPLAY`（禁止追加）/ `CANON_MUTATION`（允许追加） |
| 溯源追查权 | 每一条目**强制**登记发源出处 |
| 修订操作 | 仅支持显性替代或打标废止；**拒绝**物理抹除 |

“仅限追加”是维系平台审计信誉的基石。消费端必须能够绝对信任：历史档案反映的是原始发生的真确事实，而非经历篡改后的伪造遗迹。

## 运行模式的严格分野 (Replay Vs Canon Mutation)

| 执行模式种类 | 是否获准追加历史？ | 架构用途说明 |
| --- | --- | --- |
| `REPLAY` (回放推演) | 否 | 用于重新演算和溯源验证已发生的事件轨迹 |
| `CANON_MUTATION` (真相突变) | 是 | 用于向系统提交并落地真实的状态变动 |

Replay 进程拥有读取历史、拉起强类型投影以及演算结果的权限——但它在写入操作上被彻底阻断。只有 Canon-mutation 执行流获准进行数据追加。这种结构层面的职权隔离，是确保 Replay 能够充当绝对中立审计工具的先决条件。

## 溯源依据的强制性 (Provenance)

每一项历史条目皆携带着不可剥离的溯源标签：操作主体是谁、发生时间、基于何种证据。溯源是**系统级强约束 (Mandatory)**——脱离该信息的数据包在提交阶段即面临系统阻截。

| 约束字段 | 架构用途 |
| --- | --- |
| Actor | 执行动作的施事主体 |
| Time | 事件发生的精确时间戳 |
| Evidence refs | 支撑该条动作合理性的佐证链接 |
| Schema version | 数据载荷遵循的结构规范版本 |
| Source | 触发记录生成的系统来源（扩展 App、系统级守护进程等） |

任何缺少溯源标签的编造记录将在准入校验关卡直接遭到驳回 (Rejected)。平台体系未配置容忍“匿名不明记录”的降级接收通道。

## 历史缺陷的正规修正流 (Corrections)

当创作者（抑或平台系统）需要针对过往历史实施纠偏作业时，必须顺应已获准入的规范修正路径：

| 修正流类别 | 系统行为表现 |
| --- | --- |
| 替代 (Supersession) | 推入新记录以宣告前置版本作废；原始旧记录原样保留在时间轴中。 |
| 废止 (Invalidation) | 对特定记录打上失效标记；原始实体在库内不可抹去。 |

系统防线绝对封死的操作：静默物理删除。一旦成功落库 (Committed) 的历史真相便失去了“凭空蒸发”的可能性。后续的系统核查人员总能顺藤摸瓜检索出：“此记录曾被正式提交，随后出于原因 X 被声明作废或替代”。

## 场景分析：阻击缺乏溯源的黑户记录

某越权 App 试图向系统暗中塞入一条剥离了溯源追踪身份的历史指令。

1. **准入关卡激活**。Realm 内核基于严苛的规范历史结构 (Admitted history shape) 展开接收校验。
2. **缺失溯源曝光**。安检探针查实该提交单据未含必填的出处明细。
3. **指令阻截**。此操作立即遭遇安全熔断，抛出阻断回执。
4. **返送强类型错误**。涉事 App 接收明确报警：“Missing provenance (溯源追踪缺失)” 并附有具体识别的故障代号。

在该判定逻辑中系统不存在“尽力接纳 (Best-effort accept)”的软弱妥协。丧失来源身份的记录将被无情关在历史大门之外。

## 架构维度的金三角 (Cross-Cutting With State And Truth)

历史 (History) 同事实真相 (Truth) 以及当下状态 (State) 共同稳固了世界观模型的三角底盘。

| 系统追问 | 提供确切解答的辖区 |
| --- | --- |
| 什么是被绝对认定为真的系统事实？ | 事实真相 (Truth) |
| 该世界眼下的切片快照长什么样？ | 即时状态 (State) |
| 这个系统是如何演进成如今局面的？ | 演进历史 (History) |

试图将上述三者捏合混淆的接口设计将不可避免地静默丢失核心管控信息。世界历史专司提供关于**“路径怎么走来 (How)”** 的解答，而不是代办“实质定义是什么 (What)”或“现行断面如何 (Now)”。

## 参考来源

- [`.nimi/spec/realm/world-history.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-history.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/tables/world-history-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/world-history-contract.yaml)
- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
