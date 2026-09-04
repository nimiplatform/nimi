# Realm 真相边界

世界里什么是真的，由外部的 Realm 服务说了算：数据记录、世界生命周期规则、社交与经济的不变量，都归它定。本仓库不定义其中任何一条。

Nimi 通过 SDK 生成的客户端和强类型封装访问 Realm。对 App 代码来说，一条 Realm 事实就是你连接的 Realm 服务返回的数据，而不是 Nimi 在本地定义的东西。

## Nimi 拥有什么

| Nimi surface | 职责 |
| --- | --- |
| SDK generated Realm core | 从配置的 Realm OpenAPI 输入生成 typed client shape |
| SDK Realm facade | consumer transport、token handling、fail-closed errors 和 typed wrappers |
| Runtime/Desktop/Web/apps | 通过 SDK 边界消费 Realm projections |

## Nimi 不拥有什么

- Realm canonical records。
- Realm social、chat、economy、asset、binding、transit 或 world rules。
- Realm auth/session issuance truth。
- 本仓库内新增的本地 Realm kernel contract mirror。

如果 App 需要 Realm 数据，应使用 SDK Realm client，或在该 client 之上写 app-owned wrapper。不要复制 Realm endpoint strings、重复声明 response shapes，或把旧的本地 Realm spec mirror 当作 authority。

## 来源依据

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
