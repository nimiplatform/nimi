# Realm 消费者投影

Nimi App 读 Realm 数据时，通过 SDK 拿到的是一份强类型的本地视图。这份视图不是第二份真相，也不是 Realm 领域模型的本地副本。

App、Runtime、桌面端和网页端都通过 SDK 的强类型客户端读 Realm。本地状态可以缓存或展示 Realm 返回的内容，但本地的东西永远不能变成真相本身。

## 消费者规则

| 关注点 | 边界 |
| --- | --- |
| Generated API input | 来自配置的外部 Realm OpenAPI source |
| SDK facade | 可以用 typed fail-closed behavior 包装 generated operations |
| Runtime/Desktop projection | 可以呈现 Realm output，但不能合成 Realm success |
| App wrappers | 可以为产品 UI 适配 SDK output，但不能重新定义 Realm semantics |

当 Realm API 出现 drift 时，应从配置的 Realm input 重新生成 SDK core，并更新 consumer contracts/tests。不要通过把 Realm spec text 复制进本仓库或冻结 handwritten DTO 来补 drift。

## 来源依据

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
