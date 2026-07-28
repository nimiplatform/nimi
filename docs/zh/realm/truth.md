# Realm 真相边界

Realm 真相由外部 Realm 权威拥有。本仓库不定义 Realm server records、world lifecycle rules、social/economy invariants 或 Realm domain semantics。

Nimi 通过 SDK 拥有的 generated clients 和 typed facades 消费 Realm。这意味着 App 代码应该把 Realm facts 当作配置的 Realm service 返回的 API 输出，而不是本地 Nimi spec truth。

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
