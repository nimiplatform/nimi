# Realm 与组合

本页说明 SDK vNext 中 Realm 真值消费与世界相关组合的读者视角。旧的 `@nimiplatform/sdk/world` 子路径不在公开 surface 中。世界相关 workflow 通过 SDK root composition、Realm helper 与已准入的 feature module 承载。

## Realm 持有什么

Realm 持有语义真值：账户、profile、社交数据、世界状态、世界历史、资产，以及 App 可见的 Realm 记录。SDK 暴露 App-facing 的强类型访问，但不允许 App 调用 Realm 私有内部或 raw REST route。

App 应使用：

- `@nimiplatform/sdk` root client 上的 `client.realm`；
- `@nimiplatform/sdk/realm` 直接消费 Realm facade；
- facade 暴露出的生成 Realm service boundary。

## 世界相关组合

世界 workflow 通常需要 Realm 真值加 Runtime 执行。vNext 中这不是独立的 `world` package root。组合应落在：

- 跨 Runtime 与 Realm 的 SDK root client；
- 读取已准入 Realm 真值的 `@nimiplatform/sdk/realm`；
- 已准入为 feature-level developer experience 的 `@nimiplatform/sdk/features/workflow`。

组合必须保持权威线可见。Realm 仍持有真值，Runtime 仍持有执行。SDK helper 不会变成第三个真值来源。

## 场景：先读状态，再运行 Agent 工作

1. App 通过 `client.realm` 或 `@nimiplatform/sdk/realm` 读取世界状态。
2. App 通过 `client.runtime`、`@nimiplatform/sdk/runtime`，或已准入的 `@nimiplatform/sdk/ai-runner` / feature helper 运行 Agent 工作。
3. 如果执行改变 Realm 真值，写入必须通过已准入的 Realm contract。App 不在本地重述真值。
4. App 再通过 SDK 重新读取 Realm 状态。

## 这个 surface 不做什么

- 不恢复 `@nimiplatform/sdk/world`。
- 不允许 App 代码直接调用 raw `/api/...` Realm REST。
- 不把 Runtime-local execution evidence 提升为 Realm 真值。
- 不让 feature helper 拥有 Runtime RPC parity 或 Realm 语义。

## 来源依据

- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/world-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/world-contract.md)
- [`.nimi/spec/sdks/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/surface-contract.md)
- [`.nimi/spec/sdks/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/boundary-contract.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
