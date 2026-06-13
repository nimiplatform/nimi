# 平台架构

Nimi 切成多个权威面，让任何一层都不会悄悄重写另一层的真相。这一节给的是跨层地图；规范本身保留契约的精度。

这一页是架构的导读，不是架构本身。规则级权威归在 `.nimi/spec/platform/kernel/` 下。

## 高层形状

在高层视角下，Nimi 把职责分给以下几方：

- **平台（Platform）** 定义世界模型、六项基础协议，以及谁有权重新定义什么的权威规则。
- **Runtime** 持有 AI 执行、工作流、流式、模型与 provider 治理、本地能力路由、委派、审计，以及 Runtime 持有的 Agent 参与。
- **SDK** 给 App 一个官方接入面，让 App 不必导入私有内部实现。
- **Realm** 持有语义真相、世界状态、世界历史、聊天，以及相关的领域契约。
- **桌面端（Desktop）** 承载原生第一方能力与外壳级工作流。
- **网页端（Web）** 在浏览器里呈现选定面的受限版本。
- **Avatar** 把具身 Agent 的呈现作为独立领域来持有。
- **Cognition** 独立持有 memory、知识、prompt 服务、引用、completion，以及 Runtime 桥语义。

这种切分让集成方式保持灵活，又不会让每个包都变成自己的真相源。

## 跨层通信

平台规范冻结了一组小而稳的跨层关系。下图每一道箭头都对应一份准入的契约面：

```
desktop      ->  nimi-sdk         : 统一开发者接入面
desktop      ->  nimi-runtime     : 走 gRPC 接入 Runtime
nimi-apps    ->  Realm source authority       : REST + WS 接入 Realm
nimi-runtime <-> nimi-cognition   : Runtime 桥 / 消费重叠
                                    （权威源仍归 Cognition）
```

由这张图能引出两件事：

- Cognition 经由 Runtime 桥可达，但 Runtime 不吞并 Cognition 的权威。桥是消费，不是归属。
- App 使用 SDK 边界，不直接导入 Runtime 或 Realm 的私有内部。

## 场景：App 发起一次生成请求

某个 App 需要请 Runtime 在某个世界的上下文里生成一段流式多模态响应。架构告诉它：

1. App 通过 `@nimiplatform/sdk/runtime` 或 SDK root client 发请求。它不导入 Runtime 私有模块；SDK 是边界。
2. Runtime 持有工作流与流式生命周期。它知道请求何时 `ACCEPTED`、流何时开始、终态帧何时给出、工作流何时 `COMPLETED`。
3. 如果 App 同时需要读世界真相（比如想知道有哪些参与者），它走 `@nimiplatform/sdk/realm` 或 root-client Realm composition。它不导入 Realm 内部。
4. 如果工作流需要 memory，Runtime 在桥契约下接入 Cognition。App 看不到 Cognition 的内部。
5. 如果响应里包含多模态制品，制品走 Runtime 的 artifact 契约，而不是临时拼出来的 URL。

每一步都受准入契约约束。架构存在的意义，恰恰是不让这几步被悄悄地走捷径。

## 公共与非公共权威

公共仓库公开的是平台、Runtime、SDK、桌面端、网页端、Avatar、Cognition、Nimi Coding 这些面。私有的 Realm 后端权威、Dashboard 权威、创作者侧权威，归在它们各自的归属位置，不会被默默吸入这一份公共文档。

这一区分对读者重要。一页讲 Realm 语义，讲的是公共读取路径，不是后端或创作者控制面的全部契约。

## SDK 为什么重要

App 不能直接跨进 Runtime 或 Realm 的私有内部。SDK 是公开的集成面。它让 App 在不导入私有实现边界的前提下，组合 Runtime 支撑的生成、Realm 真相读取与 scope 流程。

App 越过这道边界会出两件事。第一，它绑死在会改变的内部上。第二，它会形成自己对 Runtime 或 Realm 行为的本地预期，这种预期会与契约偏移，悄悄地长成本地的真相。

## 来源依据

- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/platform/kernel/app-slice-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/app-slice-admission-contract.md)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdks/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/index.md)
