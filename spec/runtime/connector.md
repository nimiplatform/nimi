# Runtime Connector Domain Spec

> Scope: Connector 主题阅读导引（凭据托管、字段约束、探测与路由边界）。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

- `kernel/connector-contract.md`（K-CONN-001, K-CONN-002, K-CONN-004, K-CONN-006, K-CONN-012）
- `kernel/rpc-surface.md`（K-RPC-007, K-RPC-008, K-RPC-009）
- `kernel/authz-ownership.md`（K-AUTH-001, K-AUTH-004）
- `kernel/key-source-routing.md`（K-KEYSRC-001, K-KEYSRC-004）
- `kernel/error-model.md`（K-ERR-001, K-ERR-005）
- `kernel/tables/provider-catalog.yaml`
- `kernel/tables/provider-capabilities.yaml`

## 1. 文档定位

本文件只提供 connector 主题导航。connector 的行为规则、字段约束与错误语义由 kernel 与 tables 统一定义。

## 2. 阅读路径

1. 先读 connector 主合同：`kernel/connector-contract.md`。
2. 再读 RPC 外部面：`kernel/rpc-surface.md`。
3. 然后读 ownership 与 key-source：`kernel/authz-ownership.md`、`kernel/key-source-routing.md`。
4. 最后对齐 provider 能力事实源：`provider-catalog.yaml` + `provider-capabilities.yaml`。

## 3. 模块映射

- Connector service：`runtime/internal/services/connector/`。
- Remote 执行路径：`runtime/internal/nimillm/`。
- Local 执行路径：`runtime/internal/services/localservice/`。

## 4. 非目标

- 不在 domain 文档定义本地规则号。
- 不在本文件维护执行策略和测试快照。
