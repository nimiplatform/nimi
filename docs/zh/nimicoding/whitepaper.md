# Nimi Coding 白皮书

在 Nimi Coding 的视角里，AI 辅助实现承担的是权威，而不只是代码生成。一句话讲清楚它的主张：复杂的 AI 协作要做成，必须在结果被认作「完成」**之前**就把权威、范围、执行 packet、审计闸口、闭合标准全部写清楚。

这一页就为这个主张做论证，并把它要应对的失败形态摆出来。

## 一般的 AI 协作为什么不够用

小改动好办：助手读几个文件，改一段代码，跑一次测试，就可以收工。一旦项目足够复杂，这种做法就开始失灵。常见的失败形态有几类：

- 沿用看起来权威、其实早已过时的文档；
- 凭推断补出从未被准入的产品事实；
- 留下旧的兼容路径，理由仅仅是它还能编译；
- 看到 build 通过就把任务关掉，可用户那一端的结果其实是错的；
- 交付的工作在某一个闭合维度上看似完整，在另一个维度上却交不出账。

这几类失败有个共同特点：助手在自己的循环里面非常难察觉。它们发生的当下都长得像成功。

## Nimi Coding 的模型

Nimi Coding 把这件事拆成五个互不混淆的关注点：

| 关注点 | 要回答的问题 |
| --- | --- |
| **权威** | 真相住在哪里？ |
| **Packet** | 这个 worker 能读什么、能写什么、能声称什么？ |
| **Wave** | 当前在闭合哪一个 owner 域？ |
| **审计** | 有什么证据证明这次工作没有漂移？ |
| **Closeout** | 为什么这件事在权威、语义、消费方、抗漂移这四件上都已经收口？ |

这个模型并不取消迭代。它做的是让迭代可审计。

## 四个闭合维度

一个 wave 只有这四个维度全部满足才算闭合：

- **权威闭合**：工作落在已准入的权威范围里面，没有悄悄越界。
- **语义闭合**：工作真正表达了它本应表达的合同含义。
- **消费方闭合**：工作切实服务到了使用它的人或系统。
- **抗漂移闭合**：工作没留下让漂移以后再回来的脚枪。

「看起来做完了、其实没做完」这一类失败，几乎都能对应到其中某一维不过、其他维过的状态。一次文档重写可以同时权威闭合（spec 没动）和语义闭合（散文与合同一致），却因为渲染出来的文档读不像公开文档而消费方那一关没过。

## 阅读场景：当前 pending 的 topic

当前仍在 pending 的这次文档 remediation 是个真实例子：

1. 更早一次的 topic 把公开文档重整为 source-anchored 形态。权威闭合很干净：spec 没动，每一条对外声明都有出处。
2. 语义闭合也很干净：散文如实反映 spec 合同。
3. 消费方那一关没过：用户反馈说文档读起来像审计工件，而不是公开文档。
4. 抗漂移闭合等的是人工接受度，但人工接受度始终没到。
5. 于是这个 topic 留在 pending，没被强行标 complete。

这就是四维模型抓得到、单维「build 过了」之类的规则会漏掉的东西。

## 为什么这套流程不是官僚主义

Topic 流程乍看很重。它划得来，是因为 AI 实现非常擅长交出一种「看上去合理、其实错了」的产物。在普通代码库里，code review 与测试是主要的拦路关；AI 加进来以后，助手有能力把不正确的东西做得能过这两关，权威、范围或消费方贴合度依旧错。

Nimi Coding 不取代 code review。它加的是几道 code review 单凭自身抓不到的关。

## 消费方闭合的分量

人类可读文档这个 remediation topic 之所以存在，就是因为上一次文档重写过了机器关、没过人工关。这正是 Nimi Coding 想暴露出来的失败形态：一项工作可以做到 source-anchored、lint 干净、build 干净，仍然不满足消费方。

遇到这种情况，正确的动作是让 topic 继续留在 pending、再开一个后续 wave 去处理它，而不是宣布工作完成。

## 来源

- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
