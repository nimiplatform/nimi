# 平台架构

Nimi 切分成若干权威面，让一层不会无声地重新定义另一层的真相。公开文档给你跨层地图；规范保留实际合同的精度。

本页是架构的阅读辅助，不是架构本身。规则级权威住在 `.nimi/spec/platform/kernel/`。

## 高层形状

| 层 | 拥有什么 |
| --- | --- |
| Platform | 世界模型、六个基础协议、谁有资格重新定义什么的权威规则 |
| Runtime | AI 执行、工作流、流式、Model 与 Provider 治理、本地能力路由、委派、审计、Runtime-owned Agent 参与 |
| SDK | 应用的官方接入边界，让 App 不必 import 私有内部 |
| Realm | 语义真相、世界状态、世界历史、聊天、相关域合同 |
| Desktop | 第一方原生能力，包括 Mod 面和外壳级工作流 |
| Web | 浏览器里选定面板的受限版 |
| Avatar | 具身 Agent 呈现，独立成域 |
| Cognition | 独立的记忆、知识、Prompt 服务、引用、补全、Runtime 桥语义 |

这种结构让集成保持灵活，又不会让每个包都变成一个独立的真相来源。

## 跨层通信

平台规范冻结了一组小的跨层关系。下面图里每根箭头都对应一条已认可的合同面：

```
mods         <-> desktop          : 进程内 hook runtime
desktop      ->  nimi-sdk         : 统一开发者面
desktop      ->  nimi-runtime     : gRPC runtime 接入
nimi-apps    ->  nimi-realm       : REST + WS realm 接入
nimi-runtime <-> nimi-cognition   : runtime 桥 / 消费重叠
                                    （权威仍归 cognition）
```

两点直接的后果：

- Mod 不会绕过桌面端的 hook runtime。Mod 直接调 `nimi-runtime` 等于跳过了桌面端的能力边界。
- Cognition 通过 Runtime 的桥可达，但 Runtime **不**吸收 Cognition 的权威。桥是消费，不是所有权。

## 阅读场景：App 发起一次生成请求

设想一个 App 要让 Runtime 在某个世界上下文里生成一段流式多模态回应。架构说：

1. App 通过 `sdk/runtime` 发起请求。它**不** import 私有 runtime 模块；SDK 是边界。
2. Runtime 拥有工作流和流式生命周期。它知道请求何时 `ACCEPTED`、何时开流、何时发终止帧、何时 `COMPLETED`。
3. 如果 App 还需要读世界真相（比如知道哪些参与者在场），它用 `sdk/realm` 或 `sdk/world`，这两个 SDK 子路径暴露 Realm 合同。它**不** import Realm 内部。
4. 如果工作流需要记忆，Runtime 在桥合同下接桥到 Cognition。App 不会看到 Cognition 内部。
5. 如果回应里包含多模态产物，它走 Runtime 的产物合同，不走临时 URL。

每一跳都受一条已认可合同约束。架构存在的目的，正是让这些跳跃**不能**被无声跳过。

## 公开 vs 私有权威

公开仓库记录公开的 Platform / Runtime / SDK / Desktop / Web / Avatar / Cognition / Nimi Coding 面。私有 Realm 或后端权威、Dashboard 权威、创作者侧权威留在它们自己的所有者位置，不会被无声地吸收进公开文档。

这一区分对读者有意义。如果一页讲 Realm 语义，它讲的是公开的读路径，不在暴露每个后端或创作者控制面合同。

## SDK 为什么重要

App 不应该越过私有 Runtime 或 Realm 内部直接调用。SDK 是公开接入面。它让应用代码组合 Runtime 支撑的生成、Realm 真相读、Scope 流程、Mod 面，而不需要 import 私有实现边界。

App 一旦违反这条边界，会出两件事。第一，App 跟可能变化的内部耦合。第二，App 开始形成自己对 Runtime 或 Realm 行为的本地预期；这种预期可能漂移，变成无声的本地真相。

## 来源

- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/platform/kernel/app-slice-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/app-slice-admission-contract.md)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdk/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/index.md)
