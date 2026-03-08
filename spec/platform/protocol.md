# Platform Protocol

> Domain: Platform / Protocol

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/protocol-contract.md` | P-PROTO-001–105 |
| `kernel/tables/protocol-error-codes.yaml` | 协议错误码字典 |
| `kernel/tables/protocol-primitives.yaml` | 六原语字段合同 |
| `kernel/tables/compliance-test-matrix.yaml` | L0-L2 合规矩阵 |
| `kernel/tables/audit-events.yaml` | 审计事件字典 |
| `kernel/tables/app-authorization-presets.yaml` | 授权预设 |
| `kernel/tables/participant-profiles.yaml` | 参与方画像 |
| `kernel/tables/error-code-mapping.yaml` | Platform → Runtime 错误码映射 |
| `kernel/tables/rule-evidence.yaml` | P-* 规则证据映射 |

## 1. 文档定位

本文件提供协议阅读导引。封装字段、版本协商、授权语义、六原语规则以 P-PROTO-* 为唯一规范来源。

## 2. 阅读路径

1. 版本与封装：P-PROTO-001、P-PROTO-010、P-PROTO-011。
2. 授权与 scope：P-PROTO-020、P-PROTO-030、P-PROTO-035、P-PROTO-040。
3. World-App 与模式边界：P-PROTO-050、P-PROTO-060。
4. 六原语与一致性：P-PROTO-070、P-PROTO-100–105。
5. 下游实现锚点：`spec/runtime/kernel/auth-service.md`、`spec/runtime/kernel/grant-service.md`、`spec/sdk/kernel/scope-contract.md`、`spec/realm/kernel/interop-mapping-contract.md`。

## 3. 事实源映射

- 错误码与 actionHint：`kernel/tables/protocol-error-codes.yaml`。
- 原语字段合同：`kernel/tables/protocol-primitives.yaml`。
- 合规测试矩阵：`kernel/tables/compliance-test-matrix.yaml`。
- 审计事件字典：`kernel/tables/audit-events.yaml`。
- App 授权预设：`kernel/tables/app-authorization-presets.yaml`。
- 参与方画像与 app 模式：`kernel/tables/participant-profiles.yaml`。
- Platform → Runtime 错误码对应：`kernel/tables/error-code-mapping.yaml`。
- 规则证据路由：`kernel/tables/rule-evidence.yaml`。

合规矩阵本身由 Platform kernel 管理；实际执行门与测试证据分别落到 `spec/runtime/*`、`spec/sdk/testing-gates.md`、`spec/desktop/testing-gates.md` 与 `dev/report/*`，Platform domain 不复制下游 gate 细节。P-* 的 formal 证据映射以 `kernel/tables/rule-evidence.yaml` 为唯一事实源。

## 4. 非目标

- 不在 domain 层新增协议规则号。
- 不在本文件维护执行快照与门禁结果；结果写入 `dev/report/*`。
