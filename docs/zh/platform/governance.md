# 平台治理

Nimi 采用显式的权威准入流程，因为平台跨越多个权威域。Runtime、SDK、Realm、桌面端、网页端、Avatar、Cognition、Nimi Coding 之间互相连接，但任一方都不能非正式地覆盖另一方的真相。

本页解释这条规则的实际形态，以及它对读者与贡献者意味着什么。

## 实际规则

凡是会改变产品行为、兼容性、归属或公开含义的主张，必须先有一个准入的权威来源，才能作为事实出现在文档或实现里。

这条规则避免公开页面变成事实意义上的规范，也避免 App 包发明出与平台模型相冲突的本地真相。

## 为什么准入在 AI 平台上格外重要

AI 平台对悄无声息的权威漂移特别敏感。一个本地小工具可能长成一条平行路由规则；一份文档页可能描述实现从未同意的行为；一个 App 可能因为 Runtime 调用碰巧能跑而绕过桌面端边界。

每一类失败从一侧看都微小且可逆，从另一侧看就是契约违例。准入把这些时刻变成显式的跨域决策。

## 场景：新增一项能力

假设有人想给 Runtime 加一条新的本地能力路由，App 经 SDK 消费它。治理规则要求：

1. 这条路由的权威必须有归属。Runtime 是最合理的拥有者，因为本地能力路由归在 Runtime。
2. 如果这条路由还要新增 SDK 接口面，SDK 必须显式准入这一面。SDK 不会自动把新的 Runtime 行为呈现出去。
3. 如果这条路由会改变桌面端或网页端的状态展示，消费侧也得准入这次变更。桌面端不会因为 Runtime 加了路由就自动继承新的体验。
4. 如果文档要公开提及这项新能力，页面要带 source basis。文档不能预告尚未准入的行为。

每一步都对应一次准入的契约更新，而不是 PR 评论里随手一句。

## 场景：一次失败的闭合

假设外部 AI 宿主完成了一次公开文档重写。构建通过，source basis 正确，页面对复核者也
没有明显错误，但用户认为它仍不具备公开文档的可读性。此时只有权威与语义证据，消费者
闭合仍未成立。任务生命周期继续由外部 AI 宿主负责；Nimi Coding 只提供方法论约束与
确定性门禁，不创建 pending 状态、工作轮次或完成记录。

独立闭合维度让这类缺口可见；单一构建结果不能证明任务完成。

## 这对读者意味着什么

公开页面写"某能力是契约级"，意思是形态已规定，但公开运营可用性可能仍受闸门控制。公开页面写"某接口面是渲染态"，意思是这页可读地解释一个上游来源，而不是自己变成第二权威。

如果这种区别会影响你的决策（例如下游项目要不要依赖某个行为），就顺着页面的 Source Basis 找规范。kernel 规则才是权威答案。

## 来源依据

- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
