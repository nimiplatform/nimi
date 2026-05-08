# 假闭合类型

假闭合，是输出在某一闭合维度看似完整、却在另一维度失败的情形。方法论把实践中常见的几种假闭合形态分门别类，每一种都有对应的处置方式。

## Build 通过 / 消费方失败

build 是绿的、测试通过、Source Basis 也已经引用，但消费方（读者、用户、运维）拒收输出。

| 症状 | 处置 |
| --- | --- |
| build 是绿的 | 议题保持 `pending`，不要标记 closed |
| 测试通过 | 准入一次新 wave，专门处理消费方维度 |
| 用户拒收 | 不要回头修改已闭合 wave 的记录 |

**真实案例**：先前那个公开文档议题，正是触发了本轮文档修复。权威、语义、抗漂移三者都通过，消费方不通过。

## Source Basis 完整 / 文本不可读

每一句对外声明都有规范依据，文本却写得像审计余渣，读者根本无法构建心智模型。

| 症状 | 处置 |
| --- | --- |
| Source Basis 完整 | 准入一次重写 wave |
| 读者无法构建心智模型 | 按读者用途重组结构 |

后续 wave 不会重开 Source Basis 决定，只处理可读性缺口。

## 已闭合 / 未被接受

wave 在机器侧闭合，但人侧验收没有记录。方法论里 `pending` 状态搭配显式 `close_trigger`，正是为这种情形保留的。

| 症状 | 处置 |
| --- | --- |
| wave 收尾已记录 | 议题状态停在 `pending`，等待验收 |
| 用户尚未复核 | 不要推进到 true-close |
| 验收关卡未记录 | 维护 pending-note 与重开标准 |

议题不会推进到 true-close，直到验收被记录。

## OVERFLOW 与 PASS

某次 wave 在 packet 边界内未能完成，返回 `OVERFLOW`，既不是 `FAIL`，也不是 `PASS`。

只有当下列条件**同时满足**时，OVERFLOW 续作才被准入：

- 方向仍然正确
- 范围未跨入新的所有者域
- 当前状态可接受，只是 packet 边界本身切得太薄

下列情况 OVERFLOW 续作**被拒绝**：

- 引入了影子真相
- 需要 fallback 或 alias 才能往下走
- packet 跨入了新的所有者域

这条区分阻止了一种最隐蔽的假闭合：一次溢出的 wave 被悄悄延伸到所有者域之外，隐含范围一路堆积。

## 提前 true-close

议题被移入 closed 文件夹，但没有记录显式的 true-close 审计。

| 症状 | 处置 |
| --- | --- |
| 文件夹已移入 closed/ | 核对 `topic.yaml.current_true_close_status` |
| `current_true_close_status: not_started` | 回滚；先记录 true-close 审计 |
| 已通过的 true-close 之后被撤销 | 记录撤销血缘 |

已通过的 true-close 仍可能被后续独立审计撤销；撤销后的 true-close 需要补上后续血缘。

## 伪进展

新 wave 名字一个接一个，却没有对应的新闭合。wave-DAG 策略的反模式条目专门捕捉这种情形。

| 症状 | 处置 |
| --- | --- |
| wave 已准入但没有主闭合目标 | 拒绝准入 |
| wave 已准入但未达成有界结果 | 暂停或重做预检 |
| wave 名字层层嵌套 | 停下；改名不等于闭合 |

一次 wave 必须有一个主闭合目标。说不出目标，那就不是 wave，而是规划绕道。

## 局部需求陷阱

小请求不断挤掉主线目标——议题原本是关于 A，最终变成 B、C、D 的零碎修复积压。

| 症状 | 处置 |
| --- | --- |
| 议题里堆了不相关的零碎修复 | 拒绝；议题是单条主迭代线 |
| 每个零碎修复都自成一次 wave | 把零碎修复挪出议题纪律之外 |

开发节奏规则规定：议题是**单条主迭代线**的归处，不是微型 backlog。

## 巨型规划议题

议题始终不肯收敛到一次有界 wave 上。

| 症状 | 处置 |
| --- | --- |
| 多次连续规划 wave | 停下；规划型 wave 连续不超过一次 |
| 规划之后仍未达成有界闭合 | 暂停或重做预检，而不是开新的规划 wave |

wave 上限策略写得很清楚：规划可以把一个执行目标硬化下来，但不能无限连成串。

## 读者场景：识别正在进行中的失败

你正在管理一个议题。第一次 wave 的审计返回 `PASS`。但用户审看渲染输出后说"对是对，不够亮眼"。

这是**build 通过 / 消费方失败**的形态。审计本身是正确的（按机器口径 PASS），消费方那一维不通过。

处置：

1. 不要回头修改 wave-1 的记录。审计本身是对的。
2. 议题保持 `pending`。
3. 准入 wave-2，专门处理消费方缺口。
4. wave-2 的 packet 根据用户反馈写出新的验收不变量。
5. wave-2 在消费方维度满足时闭合（再交下一轮用户复核）。

方法论把"我不知道下一步该做什么"，变成一段强类型的处置序列。

## 读者场景：读懂一份 OVERFLOW 裁决

某次 wave 返回 `OVERFLOW`，不是 `PASS` 也不是 `FAIL`。worker 在实施过程中撞到 packet 边界。

你逐项核对：

- 方向是否仍然正确？是——正在做的就是计划要做的。
- 范围是否跨入新的所有者域？否——工作仍在声明的所有者域内。
- 是否引入影子真相？否——没有产生并行路径。
- 是否需要 fallback 或 alias？否——遇阻直接拒绝退化。
- 当前状态可接受、packet 边界过薄？是。

**续作可准入。**准入一份续作 packet，把边界扩开，完成剩余工作。

如果上述任何一项答"是"指向影子 / fallback / 新所有者域，续作就**被拒绝**，wave 退回修订。

## 读者场景：议题卡在规划阶段

某议题已经持续数周。准入了三次 wave，全是规划型，没有一次达成有界闭合。

这是**巨型规划议题**反模式。

处置：

1. **不再开新的规划 wave。**wave 上限策略禁止开第四次规划。
2. **暂停议题**，附上显式 pending-note；或者
3. **重做预检。**重新构造，再尝试一次，但停止线要更锐利。

如果管理者直接以另一个规划名义准入 wave-4，那就是伪进展。方法论的上限正是阻止这件事的机制。

## Source Basis

- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/overflow-continuation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/overflow-continuation-policy.yaml)
- [`.nimi/methodology/wave-dag-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/wave-dag-policy.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
- [`.nimi/contracts/overflow-continuation.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/overflow-continuation.schema.yaml)
