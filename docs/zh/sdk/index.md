# SDK

Nimi SDK 是 App 代码真正会去调用的那一层。它给出一条受支持的入口去用 Runtime、Realm、世界语义、AI provider、作用域、mod 与共享类型，同时不需要从这些底层导入私有内部。

如果你在 Nimi 上做开发，第一个要看的边界就是 SDK。守住这条边界的 App，能在 Runtime 与 Realm 内部演进时不受影响；越界的 App，则会把对方每一次内部变化都吃成一次破坏性升级。

## 本节内容

- [边界](/zh/sdk/boundaries) — App 应当遵守的导入与调用规则。
- [Runtime Client](/zh/sdk/runtime-client) — 通往 Runtime 行为的公开 App 路径。
- [Realm 与 World Client](/zh/sdk/realm-world-client) — Realm 真值与 Runtime 生成能力的组合。

跨域的[术语表](/zh/glossary)解释了 surface、boundary、projection 这些词。

## SDK 为什么存在

Nimi 有多个权威域。Runtime 持有执行；Realm 持有语义真值；桌面端持有原生 shell 行为；Cognition 持有独立的记忆与知识权威。App 代码需要一种稳定的方式去使用这些域，又不被它们的私有实现绑死。

SDK 就是这条边界。该边界由 SDK 内核在 `S-BOUNDARY-*` 与 `S-SURFACE-*` 规则族下准入。

## 主要 surface

SDK 拆成多个命名子路径，每个子路径有自己的 surface 契约：

| 子路径 | 含义 |
| --- | --- |
| `runtime` | Runtime 支撑的调用与传输面改写 |
| `realm` | 公开的 Realm 门面与生成式 client 边界 |
| `world` | 世界真值与 Runtime 生成能力的组合 |
| `ai-provider` | 通过 Runtime 暴露的 AI provider 改写 |
| `scope` | 授权与目录生命周期改写 |
| `mod` | 宿主注入的 mod 能力 |
| `types` | 共享公开类型 |

App 通常会从多个子路径同时导入。拆分的意义在于：每个子路径都能在自己的契约下独立演进，不污染其他子路径。

## 活动 surface 与已定义 surface

规范区分活动核心 surface 与已定义但实现尚未完成的 surface。公开文档不应在实现证据出现之前，把"已定义的未来 surface"当作完整可用的产品来介绍。

读者只需记住一条经验法则：当某页说一个 surface 是"契约级"的，对应契约已准入；说它是"projection 级"的，则 surface 形状已成型，但实现还未当作完整公开产品对待。

## 场景：第一次接入

假设你写一个 App，需要调 Runtime 做一次生成、读世界真值、并对 Realm 更新作出反应：

1. 从 `sdk/runtime` 导入。在流式契约下发出生成请求并消费流；详见 [工作流与多模态](/zh/runtime/workflows-and-multimodal)。
2. 从 `sdk/realm` 导入（如需组合的世界读取，则用 `sdk/world`）来读世界真值。不要导入 Realm 内部；SDK 改写出 App 被允许看到的视图。
3. 如果 App 需要授权与目录改写，从 `sdk/scope` 导入。
4. 只在你构建宿主注入的 mod surface 时才从 `sdk/mod` 导入。否则这个子路径不属于你的代码。
5. 共享类型来自 `sdk/types`。它们是稳定的构建块，跨子路径复用。

结果是一个不导入任何私有路径的 App。Runtime 或 Realm 内部演进时，只要 SDK 契约不变，你的 App 照常工作。

## 场景：边界违例被早期捕获

假设重构期间，一个开发者觉得"我直接从 runtime 包里导入这个 helper 算了，SDK 没问题，但多走一层"。这个导入正是 SDK 边界禁止的。

如果违例被合入，会出两件事：

- App 行为开始与 runtime 内部耦合，而内部是会变的。
- App 开始形成一种关于"runtime 应当如何"的本地预期，但这种预期没有任何准入契约支撑。

在 code review 阶段抓住这次违例，App 的接入诚信就守住了。SDK 内核的导入边界表是哪些允许、哪些不允许的权威清单。

## Source Basis

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
