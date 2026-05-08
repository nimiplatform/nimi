# 错误归属（Error Ownership）

按 Nimi 各层把错误契约、规则前缀和权威源对应起来的参考表。

## 各层归属

| 层 | 归属契约 | 规则前缀 | 它持有什么 |
| --- | --- | --- | --- |
| 平台协议 | `.nimi/spec/platform/kernel/protocol-contract.md` | `P-PROTO-*` | 跨世界协议错误码、动作提示、审计事件分类 |
| Runtime | `.nimi/spec/runtime/kernel/error-model.md` | `K-ERR-*` | reason code、错误分类、retry 与契约失败的区分 |
| Runtime 流式 | `.nimi/spec/runtime/kernel/streaming-contract.md` | `K-STREAM-*` | 终态帧、流级失败语义 |
| SDK | `.nimi/spec/sdk/kernel/error-projection.md` | `S-ERROR-*` | 面向 App 的错误呈现、强类型错误形态 |
| 桌面端 | `.nimi/spec/desktop/kernel/error-boundary-contract.md` | `D-*` | UI 错误边界、retry 策略、用户侧错误渲染 |

## 翻译表

平台到 Runtime 的映射，是协议级错误与 Runtime reason code 之间的规范翻译点：`.nimi/spec/platform/kernel/tables/error-code-mapping.yaml`。

各层各自的枚举表：

| 表 | 层 |
| --- | --- |
| `platform/kernel/tables/protocol-error-codes.yaml` | 平台 |
| `runtime/kernel/tables/reason-codes.yaml` | Runtime |
| `runtime/kernel/tables/error-mapping-matrix.yaml` | Runtime 跨层 |
| `sdk/kernel/tables/sdk-error-codes.yaml` | SDK |
| `desktop/kernel/tables/retry-status-codes.yaml` | 桌面端 |

## 区分"传输恢复"和"契约失败"

| 失败类型 | 谁能恢复 | 权威来源 |
| --- | --- | --- |
| 传输错误（网络、超时、瞬时 5xx） | retry、auth refresh | 传输 / SDK 传输契约 |
| 需要刷新认证 | auth refresh、token 轮换 | Runtime auth + SDK 传输 |
| 契约失败（强类型形态、MIME、schema、字段缺失） | retry 不能救；fail-closed | 归属契约 |
| 流式终态失败 | 流中段救不回来；发出终态失败帧 | Runtime 流式 |

retry 和 auth refresh 是传输机制，不能用来悄悄救场 decode、content-type、schema、契约这类失败。

## 一次失败穿越多层

一次失败通常会跨多层。举例：上游 provider 在流式生成中途失败，会按下表展开：

| 层 | 动作 |
| --- | --- |
| Provider | 返回瞬时错误帧 |
| Runtime provider-health | 归到 `K-ERR-*` 族 |
| Runtime 流式 | 决定恢复或终结；终结则发出强类型终态失败帧 |
| Runtime 工作流 | 工作流状态切到 `FAILED` |
| Runtime 审计 | 记录失败和 trace 血缘 |
| SDK 错误呈现 | 按 `S-ERROR-*` 投出强类型 App 侧错误 |
| 桌面端 UI | 在 `D-*` 错误边界下呈现 |
| 用户 | 看到的是受治理的失败，而不是被伪造出来的成功 |

## Source Basis

- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/protocol-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-error-codes.yaml)
- [`.nimi/spec/platform/kernel/tables/error-code-mapping.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/error-code-mapping.yaml)
- [`.nimi/spec/runtime/kernel/error-model.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/error-model.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/audit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/audit-contract.md)
- [`.nimi/spec/runtime/kernel/tables/reason-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/reason-codes.yaml)
- [`.nimi/spec/runtime/kernel/tables/error-mapping-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/error-mapping-matrix.yaml)
- [`.nimi/spec/sdk/kernel/error-projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/error-projection.md)
- [`.nimi/spec/sdk/kernel/tables/sdk-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/sdk-error-codes.yaml)
- [`.nimi/spec/desktop/kernel/error-boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/error-boundary-contract.md)
- [`.nimi/spec/desktop/kernel/network-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/network-contract.md)
- [`.nimi/spec/desktop/kernel/tables/retry-status-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/retry-status-codes.yaml)
