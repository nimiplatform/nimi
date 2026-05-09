# SDK

Nimi SDK 是应用代码（App）实际调用的接口层。它提供了一条官方支持的标准化入口，使应用能够调用 Runtime、访问 Realm 与世界语义、对接 AI Provider、管理作用域、挂载 Mod 并使用共享类型，而无需直接引入底层的私有实现。

在 Nimi 平台进行开发时，首要关注的边界即为 SDK。严格遵守此边界的应用，能够在 Runtime 与 Realm 底层架构演进时保持稳定；若越过该边界直接耦合内部实现，底层架构的任何变更都可能引发应用的破坏性故障。

## 本节包含的内容

- [边界](/zh/sdk/boundaries)：应用开发中必须遵守的导入与调用规则。
- [Runtime Client](/zh/sdk/runtime-client)：应用调用 Runtime 行为的公开路径。
- [Realm 与 World Client](/zh/sdk/realm-world-client)：Realm 语义真相与 Runtime 生成能力的组合路径。

跨域的[术语表](/zh/reference/glossary)中解释了 surface、boundary、projection 等专业词汇。

## 为什么需要 SDK

在 Nimi 架构体系中，存在多个权威域：Runtime 掌控执行权；Realm 掌控语义真值；桌面端掌控原生外壳（Shell）行为；Cognition 掌握独立的记忆与知识权威。应用代码需要一种稳定且统一的方式调度这些域的能力，同时避免与复杂的私有实现绑定。

SDK 即是这条隔离边界。该边界受到 SDK 内核的保护，并在 `S-BOUNDARY-*` 与 `S-SURFACE-*` 规则族下获得准入。

## 核心 Surface 划分

SDK 被拆分为多个命名的子路径（Subpaths），每个子路径遵循其专属的 Surface 契约：

| 子路径 | 核心含义 |
| --- | --- |
| `runtime` | 封装由 Runtime 支撑的调用逻辑与传输面的数据投影。 |
| `realm` | 提供公开的 Realm 门面及生成式客户端边界。 |
| `world` | 结合世界真值状态与 Runtime 的生成能力。 |
| `ai-provider` | 对经由 Runtime 暴露的 AI Provider 进行标准化投影。 |
| `scope` | 管理应用的授权机制与目录生命周期。 |
| `mod` | 提供宿主环境注入的 Mod 扩展能力接口。 |
| `types` | 提供跨模块共享的公开数据类型。 |

应用通常会跨越多个子路径同时导入。这种拆分旨在确保每个子路径能够在独立契约的保障下自由演进，避免模块间的交叉影响。

## 活动 Surface 与已定义 Surface 的区分

规范层面对“当前活动的 Surface”与“已定义但具体实现尚在推进中的 Surface”进行了区分。公开文档不会在缺乏实现证据的前提下，将“已定义的未来 Surface”作为完整可用产品进行推介。

作为基本准则：当文档提及某个 Surface 为“契约级”（Contract-level）时，表示其约束契约已正式获得准入；若称为“呈现级”（Projection-level），则表明其架构轮廓已落定，但内部实现尚未达到公开使用标准。

## 场景演示：应用的首次接入

假设您在开发一款应用，业务需要调用 Runtime 生成文本、读取世界真值，并对 Realm 状态更新做出响应。标准操作流程如下：

1. 从 `sdk/runtime` 导入。在流式契约保障下发起生成请求并使用数据流；具体规范详见 [Runtime 流式](/zh/runtime/streaming) 与 [Runtime 工作流](/zh/runtime/workflows)。
2. 从 `sdk/realm`（如需组合读取则使用 `sdk/world`）导入以获取世界真值。严禁跨越边界直接导入 Realm 的私有内部逻辑；SDK 已安全地投影出应用层获准访问的视图。
3. 若涉及权限验证与目录树管理，从 `sdk/scope` 导入相关工具。
4. 仅在构建由宿主注入的 Mod 扩展表面时，从 `sdk/mod` 进行导入。一般应用开发不涉及此路径。
5. 通用数据结构统一从 `sdk/types` 获取。它们是稳定的构建基石，支持跨子路径复用。

遵循此规范可构建出隔离底层私有路径的高内聚应用。只要 SDK 契约保持稳定，底层 Runtime 或 Realm 的内部重构将不会影响应用运行。

## 场景演示：边界违例的早期拦截

在代码重构中，开发者可能会为了便利直接从 runtime 内部包导入 helper 工具。这种绕过边界管控的私自导入行为，是 SDK 边界绝对禁止的。

若此类越界代码被合入，将引发两大隐患：

- 应用的核心逻辑开始与 Runtime 的私有内部实现产生耦合。而底层内部实现的演进随时可能导致上层代码崩溃。
- 应用会建立基于“Runtime 内部机制”的本地预期，而这种预期缺乏任何官方准入契约的授权和支撑。

在 Code Review 阶段精准拦截此违规行为，可保障应用的架构安全。SDK 内核维护的导入边界规则表，是判定操作合规性的标准依据。

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
