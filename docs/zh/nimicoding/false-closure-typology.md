# 伪闭合形态学 (False Closure Typology)

所谓“伪闭合（False closure）”，是指开发产出在某个闭合维度上看起来已经完成，但在另一个维度上实际上却失败了。Nimi Coding 梳理并命名了实践中常遇到的几种典型伪闭合形态。每一种形态都有着针对性的应对策略。

## 1. 构建通过 / 消费方失败 (Build-Pass / Consumer-Fail)

构建全绿，测试全过，真相来源也引用得很清晰，但真正的消费方（读者、用户或运维系统）却拒绝接受这份产出。

| 症状 | 应对策略 |
| --- | --- |
| 构建全绿 | 将 Topic 维持在 `pending`（挂起）状态，不要标记为 `closed` |
| 测试全过 | 准入一个新的 Wave，专门解决消费方维度的问题 |
| 用户拒绝接受 | 严禁回头篡改那个已闭合 Wave 的历史记录 |

**真实案例**：此前促成这波文档重写的“旧版公开文档任务”，就是一个典型的例子。当时权威闭合、语义闭合和抗漂移闭合全数通过，唯独折戟在消费方闭合上。

## 2. 刻板锚定真相 / 散文不可读 (Source-Anchored / Unreadable)

每一项声明都有理有据（符合 Spec），但写出来的散文由于过分锚定源码结构，机器味极重，导致读者根本无法在脑海中建立起模型。

| 症状 | 应对策略 |
| --- | --- |
| 引用来源完整 | 开启一个专门用于“重写”的后续 Wave |
| 读者无法建立心智模型 | 完全抛开源码结构，根据读者的阅读目的来重新组织叙述 |

**注意**：这个后续的 Wave 不是要去推翻之前的真相准入决策，而是要纯粹填补可读性上的缺口。

## 3. 机器层闭合 / 尚未获人类接受 (Closed-But-Not-Accepted)

Wave 在机器审计层面已经闭合，但是人类的验收结果尚未登记。方法论中带有明确 `close_trigger` 的 `pending` 状态，正是为应对这种情况而生的。

| 症状 | 应对策略 |
| --- | --- |
| 机器已记录 Wave 收尾 | Topic 维持 `pending` 状态，直到录入接收结果 |
| 用户尚未评审 | 不要将其推进至真正的闭合 (True-close) 状态 |
| 验收关卡尚未通过 | 维护好一份写明重开条件的挂起说明 (Pending-note) |

在验收结果被正式记录之前，Topic 决不能向前推进到 True-close。

## 4. 溢出与通过的界限 (Overflow Vs PASS)

当一个 Wave 在其 Packet 划定的边界内未能完成时，它返回的结果必须是 `OVERFLOW`（溢出），而不是 `FAIL`（失败）或者 `PASS`（通过）。

只有当以下条件**全部满足**时，才允许准入“溢出延续（Overflow continuation）”：
- 大方向依然正确。
- 影响范围没有越界进入新的归属域（Owner domain）。
- 目前的代码状态是可接受的，仅仅是因为 Packet 原先划定的边界太窄而做不完。

一旦发生以下任一情况，溢出延续将被**坚决拒绝**：
- 引入了影子真相（Shadow truth）。
- 迫不得已需要写 fallback 或别名（Alias）机制来救场。
- 边界已经越界踩进了新的归属域。

之所以要如此严格地区分，是为了防范一种最为阴险的伪闭合：一个原本已经溢出的 Wave 被悄无声息地拉长，暗中侵入别人的领地，囤积隐性的未授权改动。

## 5. 过早的真正闭合 (Premature True-Close)

在尚未登记显式 True-close 审计记录的情况下，就把 Topic 的文件夹扔进了 `closed/` 目录。

| 症状 | 应对策略 |
| --- | --- |
| 文件夹已被移动至 closed/ | 核查 `topic.yaml` 中的 `current_true_close_status` 字段 |
| 状态仍为 `not_started` | 回滚操作；先去补齐 True-close 的审计记录 |
| 已通过的 True-close 被事后推翻 | 必须记录撤销的追溯链条 (Lineage) |

已通过的 True-close 有可能会被后续独立的审计推翻；一旦被撤销，必须确保后续的修复有明确的追溯链条。

## 6. 虚假进展 (Pseudo-Progress)

新 Wave 的名字换了一个又一个，但实际上并没有达成任何新的闭合目标。Wave 流程图 (DAG) 规则中的反模式识别专门用于捕捉这类现象。

| 症状 | 应对策略 |
| --- | --- |
| Wave 被准入却说不清核心闭合目标 | 直接拒绝准入 |
| Wave 已准入但毫无收敛迹象 | 暂停，或者重新退回 Preflight (预检) 阶段 |
| Wave 的名字像瀑布一样无限延伸 | 叫停；改名字不等于进展闭合 |

一个真正的 Wave 必须拥有一个核心闭合目标（Primary closure goal）；如果它连这个都说不清，那它根本不配叫 Wave，而是一次漫无目的的“规划迷航”。

## 7. 局部需求陷阱 (Local-Requirement Trap)

零散的小需求反客为主，挤占了主线任务的位置——一个一开始为了解决 A 的 Topic，慢慢发酵成了一个用来修补 B、C、D 缺陷的微型任务池。

| 症状 | 应对策略 |
| --- | --- |
| Topic 内部囤积了大量无关的局部修补 | 拒绝；Topic 只能承载一条主要迭代线 |
| 每个小修补都自立门户变成一个 Wave | 把这些微小的修补移出 Topic 的纪律管控范畴 |

开发节奏（Development-rhythm）原则明确指出：Topic 是主线迭代的归宿，绝不能当成微观修补任务的 Backlog 来用。

## 8. 巨型规划陷阱 (Giant Planning Topic)

一个 Topic 陷入了永无止境的规划，永远下不定决心去落定一个有明确边界的 Wave。

| 症状 | 应对策略 |
| --- | --- |
| 连续出现多个纯规划性质的 Wave | 叫停；连续纯规划的 Wave 不能超过一个 |
| 规划了一圈依然无法闭合 | 暂停或重做 Preflight，严禁再无脑开新的规划 Wave |

关于 Wave 上限的规定极其明确：规划的意义在于把执行目标“敲死（harden）”，而不是没完没了地画饼。

## 场景案例：如何识别执行中的失败

你正在管理一个 Topic。第一个 Wave 的审计结果弹出了“PASS”。可是用户在审阅渲染出的产物时，却抱怨道：“内容是对的，但毫无感染力可言。”

这就是典型的**构建通过 / 消费方失败 (Build-pass / consumer-fail)** 形态。审计本身没问题（按照机器指标确实 PASS 了），但在消费方这个维度上失败了。

应对流程：
1. 绝对不要去篡改 Wave-1 的历史记录，因为它的审计确实是如实执行的。
2. 将 Topic 挂起（`pending`）。
3. 准入 Wave-2，专门用来填补消费方体验差距。
4. Wave-2 的 Packet 将基于用户的反馈，宣告新的验收恒定式（Acceptance invariants）。
5. 只有当消费方维度获得满足（并由下一轮用户评审确认），Wave-2 才算闭合。

方法论在这里发挥的作用，就是把团队茫然无措的“接下来该咋办”，变成了坚定且有据可查的类型化步骤。

## 场景案例：如何处理溢出裁定

一个 Wave 执行到一半，撞上了 Packet 划定的边界，返回了 `OVERFLOW`（溢出），既非 `PASS` 也非 `FAIL`。

作为管理者，你需要这样评估：
- **大方向还是对的吗？** 是的——当前干的活正是本来计划要干的活。
- **范围越界跑到别的归属域了吗？** 没有——依然在申报的归属域内。
- **引入影子真相了吗？** 没有——并未制造并行路径。
- **偷写 Fallback 或别名机制了吗？** 没有——系统拒绝用 Fallback 来遮掩错误。
- **代码写得没毛病，纯粹是 Packet 边界给得太窄？** 是的。

此时，**允许准入溢出延续（Continuation admissible）**。准入一个新的延续包，扩展边界，让工作继续完成。

如果上述问题中有任何一项（比如查出了影子路径、别名或者越界）回答了“是”，那么延续准入将被**拒绝**；Wave 必须打回重新修改。

## 场景案例：陷入“规划瘫痪”的 Topic

一个 Topic 已经断断续续执行了好几周。接连准入了三个 Wave；但三个全是纯规划性质的；至今未取得任何实质性闭合。

这就是**巨型规划陷阱 (Giant planning topic)** 反模式。

应对流程：
1. **拒绝新的规划 Wave**：Wave 上限策略直接叫停第四个。
2. **挂起 Topic**：挂起并附带明确的 Pending-note；或者
3. **重新预检 (Re-preflight)**：重新理清思路，用更锐利的止损线再试一次。

如果管理者能凭感觉随随便便准入 Wave-4 并起个好听的名字，那就是“虚假进展”。方法论之所以设下硬性拦截上限，正是为了斩断这种自欺欺人。

## 来源依据

- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/overflow-continuation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/overflow-continuation-policy.yaml)
- [`.nimi/methodology/wave-dag-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/wave-dag-policy.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
- [`.nimi/contracts/overflow-continuation.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/overflow-continuation.schema.yaml)