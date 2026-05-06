# SDK

Nimi SDK 是面向应用的接入层。它给应用一个**受支持的方式**来使用 Runtime、Realm、世界语义、AI Provider 接入面、Scope、Mod 和共享类型，而不需要 import 任何私有内部模块。

如果你在基于 Nimi 构建产品，SDK 是你应该首先关注的边界。遵守 SDK 边界的应用在 Runtime 或 Realm 内部演化时仍然能跑；绕过它的应用每一次内部演化都会变成 breaking change。

## 本章节包含

- [边界](/zh/sdk/boundaries) — 应用在 import 与调用上必须遵守的规则。
- [Runtime Client](/zh/sdk/runtime-client) — 应用进入 Runtime 行为的公开通道。
- [Realm 与世界 Client](/zh/sdk/realm-world-client) — 把 Realm 真相和 Runtime 生成组合起来。

跨域的 [术语表](/zh/glossary) 解释「面板」、「边界」等词的含义。

## 为什么需要 SDK

Nimi 有多个权威域。Runtime 拥有执行；Realm 拥有语义真相；桌面端拥有原生外壳行为；Cognition 拥有独立的记忆与知识权威。应用代码需要一个**稳定的方式**使用这些域，而不与它们的私有实现耦合。

SDK 就是这个边界。这个边界在 SDK kernel 中以 `S-BOUNDARY-*` 与 `S-SURFACE-*` 系列规则被认可。

## 主要面板

SDK 拆成命名子路径，每个子路径都有自己的面板合同：

| 子路径 | 它代表什么 |
| --- | --- |
| `runtime` | Runtime 支撑的调用与传输面 |
| `realm` | 公开 Realm 门面与生成的客户端边界 |
| `world` | 把世界真相与 Runtime 生成组合起来 |
| `ai-provider` | 经 Runtime 的 AI Provider 接入面 |
| `scope` | 授权与目录生命周期接入 |
| `mod` | 宿主注入的 Mod 能力 |
| `types` | 公开共享类型 |

应用通常会从多个子路径 import。这种切分的目的，是让每个子路径在自己的合同下独立演化，而不互相污染。

## 已认可面 vs 已定义面

规范区分**已认可**的核心面板和**已定义但实现尚未完成**的面板。公开文档不会把仅定义、尚未实现的面板说成完全可用的产品。

实用判断：当某页把一个面板称为「合同级」（contract-level），合同是已认可的；当称为「面板形状级」（projection-only，spec 中的术语），面板形状已定义但实现尚未当作完整公开产品。

## 阅读场景：第一次接入

设想你在写一个应用，需要让 Runtime 做一次生成、读世界真相，以及对 Realm 更新做出反应：

1. 从 `sdk/runtime` import。发起生成请求并按流式合同消费流式响应；详见 [Runtime 工作流与多模态](/zh/runtime/workflows-and-multimodal)。
2. 从 `sdk/realm` import（或 `sdk/world`，如果你需要组合后的世界读）来读世界真相。**不要 import Realm 内部** — SDK 只把你的应用被允许看到的部分暴露给你。
3. 如果应用需要授权和目录读写，从 `sdk/scope` import。
4. 仅当你在做宿主注入的 Mod 面时，才从 `sdk/mod` import；否则这条子路径不属于你的代码。
5. 共享类型从 `sdk/types`，是其他子路径间稳定的拼接积木。

最终结果是一个**没有 import 任何私有路径的应用**。当 Runtime 或 Realm 内部演化时，只要 SDK 合同保持稳定，你的应用就能继续工作。

## 阅读场景：边界违规被早期发现

设想重构期间一个开发者想：「我直接从 runtime 包 import 这个 helper 就行了；SDK 没问题，但又多了一层。」这个 import 正是 SDK 边界禁止的。

如果违规落地，会出两件错事：

- 应用行为现在与可能改变的 runtime 内部耦合。
- 应用开始形成对 runtime 行为的局部预期，而这个预期没有任何已认可合同。

把违规挡在代码评审是让应用接入保持诚实的方式。SDK kernel 的 import 边界表是「什么允许、什么不允许」的权威清单。

## 来源

- [`.nimi/spec/sdk/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/index.md)
- [`.nimi/spec/sdk/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/index.md)
- [`.nimi/spec/sdk/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/surface-contract.md)
- [`.nimi/spec/sdk/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/boundary-contract.md)
- [`.nimi/spec/sdk/kernel/transport-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/transport-contract.md)
- [`.nimi/spec/sdk/kernel/error-projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/error-projection.md)
- [`.nimi/spec/sdk/kernel/runtime-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/runtime-contract.md)
- [`.nimi/spec/sdk/kernel/world-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/world-contract.md)
- [`.nimi/spec/sdk/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/realm-contract.md)
- [`.nimi/spec/sdk/kernel/ai-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/ai-provider-contract.md)
- [`.nimi/spec/sdk/kernel/scope-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/scope-contract.md)
- [`.nimi/spec/sdk/kernel/mod-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/mod-contract.md)
- [`.nimi/spec/sdk/kernel/tables/sdk-surfaces.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/sdk-surfaces.yaml)
- [`.nimi/spec/sdk/kernel/tables/import-boundaries.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/import-boundaries.yaml)
