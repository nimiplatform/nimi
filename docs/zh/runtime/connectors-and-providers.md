# 连接器与 provider

## 状态：现在 (Running today)

Connector 托管与 provider 路由是 Runtime 已交付的凭据 / 路由权威。

Runtime 把云端 AI provider 当成受治理的 runtime 数据，而不是宣传文案。Provider 名字、模型能力、健康状态、路由承诺——任何一项都会影响用户预期与集成行为，所以每一项都按契约准入。

本页讲受管的云端路由。本地路由见 [本地模型](/zh/runtime/local-models)。

## 连接器

**连接器**是某个云端 AI provider 的受管身份。它持凭据，校验凭据，并报告该身份能路由到哪些模型。

| 属性 | 取值 |
| --- | --- |
| 归属作用域 | `user` / `machine-global` / `runtime-system` |
| 凭据 | 持在 daemon-config 面 |
| 校验 | 准入时校验，之后定期校验 |
| 模型清单 | 由连接器报告 |
| 生命周期 | `created → active → degraded → revoked` |

连接器不是 provider。Provider 是抽象路由，连接器是用这条路由的具体身份。同一用户在同一 provider 下可挂多个连接器（个人号 / 工作号）。具体的 provider 路由 id 是受治理的目录数据，公开文档不列名的原因见 [兼容姿态](/zh/reference/compatibility-posture)。

## Provider

**provider** 是一条规整化的云端路由。能力与端点来自一份静态 provider 目录加一份能力矩阵。Runtime 不去拉远端动态目录，provider 行为锚定在准入的目录数据上。

| 来源 | 用途 |
| --- | --- |
| `provider-catalog.yaml` | 准入的 provider 路由集合 |
| `provider-capabilities.yaml` | 每个 provider 的能力矩阵 |
| `provider-extension-registry.yaml` | 准入的 provider 专属扩展 |

读者想看现在准入了哪些 provider，去读那几张表，不是来读文档正文。文档不列 provider 名，因为这份名单是受治理的目录数据。

## nimiLLM

`nimiLLM` 是统一的远端执行路径。Provider 专属适配器把 Runtime 调用翻译成各家形态，结果以规整的流式形态回来，与背后是哪家无关。

| 层 | 角色 |
| --- | --- |
| Provider 适配器 | 把 Runtime 调用翻译成 provider 专属形态 |
| 规整化 | 统一流式、错误、元数据形态 |
| 审计 | 每次调用按强类型 reason code 记账 |

适配器层正是"换 provider 不必改应用"这句话的真实依据。用 `sdk/runtime` 的应用不关心调用通过的哪家 provider，看到的就是规整后的形态。

## Provider 健康

Provider 健康是和连接器健康分开的权威。一个连接器自身健康，但上游不健康，整条路由还是不健康的。

| 状态 | 含义 |
| --- | --- |
| `healthy` | provider 在响应，且形态符合预期 |
| `degraded` | provider 在响应，但错误率上升 |
| `unhealthy` | provider 不响应，或者返回畸形 |

Provider 状态机准入在 `runtime/kernel/provider-health-contract.md`。状态变化通过 `nimi doctor` 与 runtime 健康流可观察。

## 凭据面切分

连接器把凭据持在 **daemon-config** 面。每请求凭据（请求时由可信宿主注入）通过 **request-credential** 面。两面严格隔离：

| 面 | 来源 | 生命期 |
| --- | --- | --- |
| `daemon-config` | 连接器管理 | 持久 |
| `request-credential` | 可信宿主注入 | 单次请求 |

连接器凭据不会泄到 request-credential 槽，请求凭据也不会被持久化进 daemon-config 面。这种分离是结构性的，不是策略层的——Runtime 拒绝任何跨面搬运。

## 读者场景：新增一条云端 provider 路由

你想让一部分请求通过某家你已经有账户的云端 provider。

1. **新增连接器。** 经 runtime CLI 或桌面端的 runtime 配置，给准入的 provider 创建一个连接器。
2. **凭据。** 连接器把凭据持在 daemon-config 面。
3. **校验。** 连接器校验凭据，并报告该身份能路由到的模型清单。
4. **能力矩阵。** Runtime 知道这个连接器提供哪些能力（文本 / 图 / 嵌入 等），锚定在准入的能力矩阵上。
5. **使用。** 应用经 `sdk/runtime` 发请求，Runtime 经连接器转发，流式按规整形态返回，错误以强类型形态返回。

注意**没有发生**的事：文档没把 provider 名字当宣传词写出来。Provider 名单是准入的目录数据。

## 读者场景：会话中途 provider 退化

某条连接器的上游 provider 在生成流期间错误率突然上升。

1. **Provider 健康检测**到错误率上升，把 provider 状态切到 `degraded`。
2. **流式契约**判定在跑的流是能恢复还是必须终止。瞬时传输错误可重试，契约失败一律 fail-closed，附带强类型终止帧。
3. **健康流发出。** Runtime 健康订阅面把状态变化推给订阅者。
4. **应用降级。** 订阅了 provider 健康的应用把变化呈现给用户："provider X 退化了"，应用不会自作主张退到一个用户没配过的 provider。
5. **审计链路。** 退化事件、工作流终止帧、之后的 Runtime 决定都被记下。

不存在静默 provider 兜底。路由是受治理的，provider 不健康时由用户或应用决定下一步。

## 来源依据

- [`.nimi/spec/runtime/connector.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/connector.md)
- [`.nimi/spec/runtime/nimillm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/nimillm.md)
- [`.nimi/spec/runtime/kernel/connector-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/connector-contract.md)
- [`.nimi/spec/runtime/kernel/nimillm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/nimillm-contract.md)
- [`.nimi/spec/runtime/kernel/provider-health-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/provider-health-contract.md)
- [`.nimi/spec/runtime/kernel/model-catalog-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/model-catalog-contract.md)
- [`.nimi/spec/runtime/kernel/model-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/model-service-contract.md)
- [`.nimi/spec/runtime/kernel/key-source-routing.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/key-source-routing.md)
- [`.nimi/spec/runtime/kernel/tables/provider-catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/provider-catalog.yaml)
- [`.nimi/spec/runtime/kernel/tables/provider-capabilities.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/provider-capabilities.yaml)
- [`.nimi/spec/runtime/kernel/tables/provider-extension-registry.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/provider-extension-registry.yaml)
- [`.nimi/spec/runtime/kernel/tables/connector-rpc-field-rules.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/connector-rpc-field-rules.yaml)
- [`.nimi/spec/runtime/kernel/tables/key-source-truth-table.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/key-source-truth-table.yaml)
