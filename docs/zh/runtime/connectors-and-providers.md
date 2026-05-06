# Connector 与 Provider

在 Runtime 里，云端 AI Provider 是受治理的 Runtime 数据，不是市场宣传。Provider 名字、Model 能力、健康状态、路由承诺，每一项都会影响用户期望与集成行为，所以每一项都按合同准入。

这页讲托管云路由。本地路由见 [本地 Model](/zh/runtime/local-models)。

## Connector

**Connector** 是某个云 AI Provider 的托管身份。它持有凭据、校验凭据、报告该身份能路由到哪些 Model。

| 性质 | 值 |
| --- | --- |
| 所有者范围 | `user` / `machine-global` / `runtime-system` |
| 凭据 | 由 daemon-config 面持有 |
| 校验 | 准入时 + 之后周期性 |
| Model 列表 | 通过 connector 报告 |
| 生命周期 | `created → active → degraded → revoked` |

Connector 不是 Provider。Provider 是抽象路由；connector 是用这条路由的具体身份。同一个用户可以为同一个 Provider 配多个 connector（比如个人 vs 工作）。具体 Provider 路由 id 由目录数据治理，集成时以准入目录为准。

## Provider

**Provider** 是规范化的云路由。能力与 endpoint 来自一份静态 Provider 目录加上一张能力矩阵。Runtime 不会去拉远端动态目录 — Provider 行为锚在准入的目录数据上。

| 来源 | 用途 |
| --- | --- |
| `provider-catalog.yaml` | 准入的 Provider 路由集合 |
| `provider-capabilities.yaml` | 每个 Provider 的能力矩阵 |
| `provider-extension-registry.yaml` | 准入的 Provider 特定扩展 |

想知道当前准入的是哪些 Provider，以 Runtime 目录表为准。散文页只解释路由模型，不替目录表发明 Provider 清单。

## nimiLLM

`nimiLLM` 是统一的远端执行路径。Provider 特定适配器把不同云背后的调用产出规范化的流式结果。

| 层 | 作用 |
| --- | --- |
| Provider 适配器 | 把 Runtime 调用翻成 Provider 特定形状 |
| 规范化 | 统一流式、错误、元数据形状 |
| 审计 | 每次调用按类型化 reason code 写审计 |

适配器层让"换 Provider 不用重写 App"成立。一个用 `sdk/runtime` 的 App 不关心调用背后是哪个 Provider；它看到的是规范化形状。

## Provider 健康

Provider 健康跟 connector 健康是两个独立权威。一个健康的 connector 接到不健康的上游，整条路由仍然不健康。

| 状态 | 含义 |
| --- | --- |
| `healthy` | Provider 在响应、返回预期形状 |
| `degraded` | Provider 在响应，但错误率升高 |
| `unhealthy` | Provider 不响应或返回坏形状 |

Provider 状态机准入在 `runtime/kernel/provider-health-contract.md`。状态变化通过 `nimi doctor` 和 Runtime 健康流可观测。

## 凭据面切分

Connector 的凭据放在 **daemon-config** 面。来自可信宿主、按请求注入的凭据走 **request-credential** 面。两者严格隔离：

| 面 | 来源 | 生命期 |
| --- | --- | --- |
| `daemon-config` | Connector 托管 | 持久 |
| `request-credential` | 可信宿主注入 | 按请求 |

Connector 的凭据永远不会泄漏到 request-credential 槽位；request 凭据永远不会被持久化到 daemon-config。这层切分是结构上的，不是策略上的 — Runtime 拒绝跨面搬运。

## 阅读场景：加一条云 Provider 路由

你想把部分请求走某个你已经有账号的云 Provider。

1. **加 connector。** 通过 Runtime CLI 或桌面端的 Runtime 配置，给该准入 Provider 创建一个 connector。
2. **凭据。** Connector 把凭据放在 daemon-config 面。
3. **校验。** Connector 校验凭据，并报告该身份能路由到哪些 Model。
4. **能力矩阵。** Runtime 知道该 connector 提供哪些能力（文本 / 图像 / Embedding / 等），锚在准入的能力矩阵上。
5. **使用。** App 通过 `sdk/runtime` 发请求。Runtime 把请求经 connector 路由出去。流式规范化到达；错误类型化到达。

**没**发生的事：App 不按宣传名猜路由。Provider 列表是受治理的目录数据。

## 阅读场景：一个 Provider 中途降级

某个 connector 的上游 Provider 在生成途中开始返回升高的错误率。

1. **Provider 健康** 检测到错误率升高，把 Provider 状态搬到 `degraded`。
2. **流式合同** 决定飞行中的流是能恢复还是必须终止。瞬时 transport 错误可以重试；合同失败 fail-close 发类型化终止帧。
3. **健康流推送。** Runtime 健康订阅面通知订阅方。
4. **App 优雅降级。** 订阅了 Provider 健康的 App 把变化呈现给用户：「Provider X 降级了」；它**不会**默默回退到一个用户没配置过的 Provider。
5. **审计 lineage。** 降级事件、工作流终止帧、后续 Runtime 决策都被记下。

没有静默 Provider 回退。路由是受治理的；Provider 不健康时，下一步由用户（或 App）决定。

## 来源

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
