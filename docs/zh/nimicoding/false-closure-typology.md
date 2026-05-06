# 伪闭合形态学

伪闭合，指输出在某一个闭合维度上看着完整，在另一个维度上其实没过。方法论给从业者会真正遇到的伪闭合形态各自起了名字，每一种对应一种特定的应对。

## Build-Pass / Consumer-Fail

build 绿、测试过、source basis 都列了，但消费方（读者、用户、运维）拒绝接受这份输出。

| 症状 | 应对 |
| --- | --- |
| build 绿 | 把 topic 留在 `pending`，不标 closed |
| 测试过 | 准入一个针对消费方维度的新 wave |
| 用户拒绝 | 不要回头改已闭 wave 的记录 |

**真实例子**：这次文档 remediation topic 的前身。权威 + 语义 + 抗漂移都过了，消费方没过。

## Source-Anchored / Unreadable

每条公开声明都有 spec 出处，可整体散文是 source-anchor 味儿的，读者建不起心智模型。

| 症状 | 应对 |
| --- | --- |
| Source basis 都在 | 跟一个重写的 wave |
| 读者建不起心智模型 | 按读者目的重新组织 |

后续 wave 不去重开 source-basis 那个决策，只补可读性这一关。

## Closed-But-Not-Accepted

一个 wave 在机器侧闭合了，可人工接受度从未被记录下来。方法论里 `pending` 状态加上显式的 `close_trigger` 就是为这种情况准备的。

| 症状 | 应对 |
| --- | --- |
| Wave closeout 已记录 | Topic state 留在 `pending` 直到接受到位 |
| 用户尚未审过 | 不向 true-close 推进 |
| 接受度门尚未记录 | 维护一份 pending-note，写明 reopen 条件 |

只有记录接受度之后，topic 才向 true-close 推进。

## Overflow vs PASS

一个 wave 在 packet 边界内没做完，返回的是 `OVERFLOW`，而不是 `FAIL`，也不是 `PASS`。

Overflow continuation 只在以下条件下被准入：

- 方向仍然正确
- 范围没跨进新的 owner 域
- 当前状态可接受，packet 边界划得太窄

Overflow continuation 在以下情况**会被拒**：

- 引入了影子真相
- 需要 fallback 或 alias 才能继续
- packet 跨进了新的 owner 域

这条区分能挡住最阴险的伪闭合形态：一个溢出中的 wave 被悄悄延展过它的 owner 域，把范围一点点累积起来。

## 过早 True-Close

Topic 文件夹被搬到 closed/，可显式的 true-close 审计还没记录。

| 症状 | 应对 |
| --- | --- |
| 文件夹搬到 closed/ | 核对 `topic.yaml.current_true_close_status` |
| `current_true_close_status: not_started` | 回滚；先把 true-close 审计记录下来 |
| 已 PASS 的 true-close 后被撤销 | 把撤销 lineage 记下来 |

已 PASS 的 true-close 也可能被后来的独立审计撤销；撤销之后要补一份后续 lineage。

## 伪进展

新 wave 的名字一个接一个，可没有新的闭合在发生。Wave-DAG policy 的反模式列表就是用来抓这种情况的。

| 症状 | 应对 |
| --- | --- |
| Wave 准入了但说不出 primary closure goal | 拒绝准入 |
| Wave 准入了但拿不到边界内的结果 | 暂停，或重做 preflight |
| Wave 名字像滚雪球 | 停下；改名不是闭合 |

一个 wave 必须能说出它的 primary closure goal；说不出来，那就不是一个 wave，那是规划中的迂回。

## 局部需求陷阱

主线被零散小请求一点点替换 —— 一个本来在做 A 的 topic 慢慢变成 B / C / D 的小修小补 backlog。

| 症状 | 应对 |
| --- | --- |
| Topic 在累积无关的小修补 | 拒绝；topic 服务的是一条主线迭代 |
| 每个小修补都自成一个 wave | 把这些小修补移出 topic 纪律 |

开发节奏规则讲得很清楚：一个 topic 只对应一条主线迭代，不是一个微 backlog。

## 巨型规划 topic

一个 topic 始终没法收到一个有边界的 wave 上。

| 症状 | 应对 |
| --- | --- |
| 连续多个 planning 性质的 wave | 停下；连续 planning-only wave 上限是一 |
| 规划之后还是没拿到边界内的闭合 | 暂停或重做 preflight，不要再开新的 planning wave |

Wave 限制 policy 写得很明确：规划阶段可以把一个执行目标 harden 出来，但不能无限拼接下去。

## 阅读场景：识别一个进行中的失败

你在管一个 topic。第一个 wave 的审计返回 PASS。但用户看完渲染出的输出之后说「对是对，可没什么打动人的地方」。

这是 **build-pass / consumer-fail** 形态。审计本身没错（按机器标准是 PASS），消费方维度没过。

应对：

1. 不要回头改 wave-1 的记录，审计本身没错。
2. Topic 留在 `pending`。
3. 准入 wave-2 来补 consumer gap。
4. wave-2 的 packet 根据用户反馈写出新的 acceptance invariant。
5. 消费方维度满足了之后（视下一次用户审）wave-2 才闭合。

方法论把「下一步该干嘛」从一种摸索变成一条类型化的序列。

## 阅读场景：读懂一个 OVERFLOW 裁定

某 wave 返回的是 `OVERFLOW`，不是 `PASS` 也不是 `FAIL`。worker 在实现中途碰到了 packet 边界。

你来评估：

- 方向还对吗？对 —— 在做的就是想做的。
- 范围跨进新的 owner 域了吗？没有 —— 工作仍在已声明的 owner 域里。
- 引入了影子真相吗？没有 —— 没造出并行路径。
- 需要 fallback 或 alias 吗？不需要 —— 工作没有降级。
- 当前状态可接受吗？packet 边界是不是划得太窄？是。

**continuation 可被准入。** 准入一份延展边界的 continuation packet，把工作做完。

任意一个回答如果是「有」（影子 / fallback / 新 owner 域），continuation 就**会被拒**；wave 退回修改。

## 阅读场景：卡在规划里的 topic

某 topic 已经 ongoing 几个礼拜了。三个 wave 都准入过，三个都是 planning-only，没拿到一次有边界的闭合。

这就是**巨型规划 topic** 反模式。

应对：

1. **不再开新的 planning wave。** Wave 限制 policy 不允许第四个连续 planning。
2. **暂停 topic**，写一份显式的 pending-note，或
3. **重做 preflight。** 重新框定，更锋利的 stop line，再试一次。

如果 manager 又开了一个换名字的 wave-4 来当规划，那就是伪进展。方法论的限制就是用来拦这种情况的。

## 来源

- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/overflow-continuation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/overflow-continuation-policy.yaml)
- [`.nimi/methodology/wave-dag-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/wave-dag-policy.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
- [`.nimi/contracts/overflow-continuation.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/overflow-continuation.schema.yaml)
