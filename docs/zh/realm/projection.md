# Realm 消费者投影

本仓库里的 Realm projection 指 Nimi consumer 通过 SDK Realm boundary 接收到的形状。它不是第二套 Realm truth，也不是本地 Realm domain model。

Apps、Runtime、Desktop 和 Web 应通过 SDK 拥有的 typed clients 消费 Realm。本地状态可以缓存或呈现 Realm output，但不能成为 canonical Realm truth。

## 消费者规则

| 关注点 | 边界 |
| --- | --- |
| Generated API input | 来自配置的外部 Realm OpenAPI source |
| SDK facade | 可以用 typed fail-closed behavior 包装 generated operations |
| Runtime/Desktop projection | 可以呈现 Realm output，但不能合成 Realm success |
| App wrappers | 可以为产品 UI 适配 SDK output，但不能重新定义 Realm semantics |

当 Realm API 出现 drift 时，应从配置的 Realm input 重新生成 SDK core，并更新 consumer contracts/tests。不要通过把 Realm spec text 复制进本仓库或冻结 handwritten DTO 来补 drift。

## 来源依据

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
