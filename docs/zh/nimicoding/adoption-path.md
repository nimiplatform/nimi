# 采纳路径

谁会采纳 Nimi Coding、为什么？这页命名目标 persona 并解释每个的价值主张。

## 目标 Persona

| Persona | 拿到什么 |
| --- | --- |
| 重度用 AI 的 solo 创业者 | 没团队也有团队级 review 纪律 |
| 采纳 AI 的小团队（2-5 人工程师） | 不靠加人头扩展的结构 review 冗余 |
| 接 AI 写 PR 的开源 maintainer | 可证 contribution 纪律 |
| 有 AI-coding 合规压力的工程组织 | 审计 trail 与结构化接受度 |
| 研究 AI 工程实践的研究者 | 可观测方法学语料 |

## 重度用 AI 的 solo 创业者

最难的场景。建一个雄心系统的 solo 创业者要在没团队 review 冗余下以团队级速度运转。

痛点：

- 自己 review 自己**不**可靠。
- 测试抓行为 bug 但**不**抓权威漂移。
- AI 貌似对实际错的输出在单循环 review 下存活。

Nimi Coding 提供什么：

- Auditor 角色能路由经不同 AI session 或不同厂商，模拟团队会提供的结构分离。
- 四闭合框架让「这事 done 了吗」用证据而**不是**感觉来回答。
- 禁用捷径目录防 founder 可能还没抓到的模式。

这是项目自己的用例。Nimi（产品）就是被一个重度用 AI 的 solo 创业者建的，Nimi Coding 是让它成为可能的东西。

## 采纳 AI 的小团队（2-5 人工程师）

小团队最早撞 AI 失败模式，因为它们比 20 人团队 review 冗余少。五个 reviewer 能看到三个看不出的模式。

痛点：

- AI 加速产出；review 容量**不**线性 scale。
- 权威漂移在 PR 级**不**可见；它在几周内累积。
- Reviewer 拉伸时「我看着行」approval 变成默认。

Nimi Coding 提供什么：

- 审计在结构上跟 review 分离。团队的 PR 走正常 review；审计（对照四闭合）是不同循环。
- 禁用捷径目录在 reviewer 累时抓模式。
- Topic / wave 纪律让团队聚焦在一次一条主迭代线。

对小团队，价值是**不靠加人头扩展的 review 冗余**。

## 接 AI 写 PR 的开源 maintainer

review AI 写 contribution 的 maintainer 要 AI 被约束的什么的证据、它声称的闭合条件、权威住在哪。

痛点：

- AI 写 PR 可能看起来精致而仍然跟项目 spec 漂移。
- Reviewer 难一眼分清 AI 推理哪些是有证据的、哪些是幻觉。
- 「相信 contributor」**不** scale，contributor 是没持久利益的模型时。

Nimi Coding 提供什么：

- 一份冻结 packet 命名 contributor 被约束的什么。
- Maintainer 能读的审计 lineage、**不**靠从 PR 描述重建。
- Maintainer 能在 merge 前校验的四闭合 closeout。

对 OSS maintainer，价值是 **contribution 纪律的结构证据**。

## 有 AI-coding 合规压力的工程组织

要审计 AI 辅助工作怎么被治理 — 为合规、安全 review、团队间交接 — 的更大组织要工件 trail。

痛点：

- 「这次是 AI 辅助吗」难回头答。
- 「AI 被约束的什么」难从 PR 答。
- 审计与合规团队**不能**读自由 Slack 线或聊天 transcript 作证据。

Nimi Coding 提供什么：

- `.nimi/topics/**` 是结构化工件 trail。
- `topic.yaml` 是生命周期证据。
- Closeout 维度是结构化接受度标准。
- 审计 lineage 串 suggestion → verdict → approval → action。

对工程组织，价值是 **审计可追的 AI 辅助工作**。

## 研究 AI 工程实践的研究者

研究 AI coding 怎么成功或失败的研究者要结构化工件语料分析。

痛点：

- 多数 AI-coding 证据在聊天 transcript 里、是短暂的。
- 「AI 失败模式 X 长啥样」难从轶事答。
- 方法学非正式时跨团队可重复性差。

Nimi Coding 提供什么：

- 别的团队能采纳并产出可比工件的类型化方法学语料。
- 命名反复失败形状的伪闭合分类。
- 作为可观测实践数据的审计 / packet / closeout 工件。

对研究者，价值是 **可观测 AI 工程实践数据**。

## 什么时候**不**采纳

方法学**对它的适用范围显式**：

| 情况 | 用 Nimi Coding？ |
| --- | --- |
| 高风险或承载权威工作 | 是 |
| 复杂 remediation | 是 |
| 多 wave 迭代 | 是 |
| 跨模块 refactor | 是 |
| 极小本地修 | 否（开销超价值） |
| 一次性脚本 | 否 |
| 一次性 prototype | 否 |

强加方法学到小改动上加成本不加闭合价值。小改动的默认姿态是「正常工程卫生而**不**带 topic 纪律」。

## 阅读场景：Solo 创业者第一次采纳 Nimi Coding

某 solo 创业者用重度 AI 辅助建一个雄心系统。

1. **取得包。** 见 [安装](/zh/nimicoding/installation)。
2. **跑 `nimicoding start`。** Bootstrap 准入。
3. **重建 spec。** `nimicoding handoff --skill spec_reconstruction --json` 给 admitted host。
4. **为下次高风险改动采纳方法学。** 写 topic、准入 wave、冻结 packet。
5. **路由审计。** 用不同 AI session 跑 auditor 角色。
6. **闭 wave。** 跨四闭合。
7. **继续。** 后续高风险改动走同样纪律。

六个月后，founder 有每次实质改动的结构工件证据。权威漂移可检测。在主循环存活的错误被审计循环抓到。

## 阅读场景：Maintainer 采纳 Nimi Coding 做 PR review

某中等流量 OSS 项目的 maintainer 决定为 AI 写 PR 采纳 Nimi Coding。

1. **加包作 dev 依赖。** 在项目装 Nimi Coding。
2. **在主分支 bootstrap `.nimi/**`。** 方法学 + spec 结构变成项目一部分。
3. **更新 contributor guide。** AI 写 PR 必须含 topic / wave / packet 工件。
4. **Reviewer 读工件。** 冻结 packet + 审计 + closeout 变成 PR review 一部分。
5. **Closeout 后 merge。** Wave 闭；PR 能 merge。

改动对 AI contribution 是结构性的；人 contribution 在常规情况下不受影响。

## 来源

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
