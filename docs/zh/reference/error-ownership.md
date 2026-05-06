# 错误归属

把 Nimi 栈每一层映到它的错误合同、规则前缀、权威来源的参考表。

## 按层归属

| 层 | Owner 合同 | 规则前缀 | 拥有什么 |
| --- | --- | --- | --- |
| Platform 协议 | `.nimi/spec/platform/kernel/protocol-contract.md` | `P-PROTO-*` | 跨世界协议错误码、动作 hint、审计事件分类 |
| Runtime | `.nimi/spec/runtime/kernel/error-model.md` | `K-ERR-*` | Reason code、错误分类、重试 vs 合同失败的区分 |
| Runtime 流式 | `.nimi/spec/runtime/kernel/streaming-contract.md` | `K-STREAM-*` | 终止帧、流级失败语义 |
| SDK | `.nimi/spec/sdk/kernel/error-projection.md` | `S-ERROR-*` | App 面错误形状、类型化错误形状 |
| Desktop | `.nimi/spec/desktop/kernel/error-boundary-contract.md` | `D-*` | UI 错误边界、重试策略、用户面错误渲染 |

## 翻译表

Platform-到-Runtime 映射是协议级错误与 runtime reason code 之间的规范化翻译点：`.nimi/spec/platform/kernel/tables/error-code-mapping.yaml`。

按层枚举住在各自表里：

| 表 | 层 |
| --- | --- |
| `platform/kernel/tables/protocol-error-codes.yaml` | Platform |
| `runtime/kernel/tables/reason-codes.yaml` | Runtime |
| `runtime/kernel/tables/error-mapping-matrix.yaml` | Runtime 跨层 |
| `sdk/kernel/tables/sdk-error-codes.yaml` | SDK |
| `desktop/kernel/tables/retry-status-codes.yaml` | Desktop |

## 区分 transport 恢复与合同失败

| 失败类 | 可恢复方式 | 权威 |
| --- | --- | --- |
| Transport 错误（网络、超时、瞬时 5xx） | 重试、auth 刷新 | Transport / SDK transport 合同 |
| 需要 auth 刷新 | Auth 刷新、token 轮换 | Runtime auth + SDK transport |
| 合同失败（类型化形状、MIME、schema、缺字段） | 重试**不**可恢复；fail-close | Owner 合同 |
| 流式终止失败 | 流中**无法**救援；发终止失败帧 | Runtime 流式 |

重试与 auth 刷新只是 transport 机制。它们**永不**静默救援解码、content-type、schema、合同失败。

## 跨层错误走

单次失败通常跨多层。worked 例子：上游 Provider 在响应中途失败的流式生成请求，落为：

| 层 | 动作 |
| --- | --- |
| Provider | 返瞬时错误帧 |
| Runtime provider-health | 在 `K-ERR-*` 家族下分类 |
| Runtime 流式 | 决定恢复 vs 终止；如终止，发类型化终止失败帧 |
| Runtime 工作流 | 工作流状态搬到 `FAILED` |
| Runtime 审计 | 带 trace lineage 记失败 |
| SDK 错误合同 | 按 `S-ERROR-*` 暴类型化 App 面错误 |
| 桌面端 UI | 在 `D-*` 错误边界下露出 |
| 用户 | 看到被治理的失败、**永不**看到伪造成功 |

## 来源

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
