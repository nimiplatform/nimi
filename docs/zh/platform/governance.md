# 平台治理

Nimi 用显式的权威准入，因为平台跨越很多所有权域。Runtime、SDK、Realm、桌面端、网页端、Avatar、Cognition、Nimi Coding 互相连接，但**不被允许非正式地**互相覆盖真相。

## 实操规则

如果一项主张会改变产品行为、兼容性、所有权或公开含义，它在出现在文档或实现里之前必须有一个被准入的权威家。

这条规则避免公开页面变成"事故规范"。它也避免应用包发明与平台模型冲突的本地真相。

## 在 AI 平台上为什么准入这么重要

AI 平台对悄悄的权威漂移特别敏感。一个小的本地 helper 可能长成一条并行的路由规则；一份文档页可能描述实现从未同意的行为；一个 Mod 可能因为运行时调用碰巧能跑就越过桌面端边界。

每一种失败从一边看都很小、很可逆，从另一边看都是合同违约。准入把这些瞬间变成显式的跨域决策。

## 阅读场景：增加一项能力

设想有人想给 Runtime 增加一条本地能力路由，让 App 通过 SDK 消费。治理规则说：

1. 这条路由的权威要落在某处。Runtime 是最合理的所有者，因为它本来就拥有本地能力路由。
2. 如果这条路由还需要新的 SDK 面，SDK 必须**显式准入**这个面。SDK 不会悄悄把新的 Runtime 行为暴露出来。
3. 如果这条新路由会改变桌面端或网页端如何显示状态，那项变化也要在消费端准入。桌面端不会自动继承一条新 Runtime 路由的 UX。
4. 如果文档想公开提到这项新能力，页面需要 Source Basis。文档页**不能**预告尚未准入的行为。

每一步都对应一次已认可的合同更新，而不是一条 PR 评论。

## 阅读场景：一次失败的闭合

设想 Nimi Coding 下一个 wave 闭合了一次公开文档重写。Build 通过，Source Basis 正确，页面对 reviewer 来说也读起来还行。然后用户说："这看起来还是不像公开文档"。这是治理系统抓住一次**虚假闭合**的例子：这个 wave 通过了权威闭合和语义闭合，但**没有通过消费者闭合**。处理方式是把 topic 维持在 pending，admit 一个后续 wave 处理消费者侧的 gap，而不是宣布工作完成。

治理回路就是让这件事可见的机制。没有它，"build pass"就会被当成完成。

## 来源

- [`.nimi/spec/platform/kernel/governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/governance-contract.md)
- [`.nimi/spec/platform/kernel/app-slice-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/app-slice-admission-contract.md)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/spec/high-risk-admissions.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/high-risk-admissions.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
