# Runtime Connector Domain Spec

> Scope: Connector 主题阅读导引（凭据托管、字段约束、探测与路由边界）。
> Normative Imports: `.nimi/spec/runtime/kernel/*`

## 0. 权威导入

- `kernel/connector-contract.md`（创建/托管：K-CONN-001~002；更新/删除：K-CONN-003~004；模型列表：K-CONN-005, K-CONN-007；探测：K-CONN-006；provider 域/owner：K-CONN-008~010, K-CONN-015；并发恢复：K-CONN-011~013；分页：K-CONN-014）
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
5. 模型列表、provider canonical domain 与 owner/audit 语义：`kernel/connector-contract.md`（K-CONN-005, K-CONN-007~010, K-CONN-015）。
6. startup recovery、并发安全与 patch/update 语义：`kernel/connector-contract.md`（K-CONN-011~013）。
7. 分页字段与删除补偿边界：`kernel/connector-contract.md`（K-CONN-004, K-CONN-014）。

## 3. 模块映射

- Connector service：`runtime/internal/services/connector/`。
- Remote 执行路径：`runtime/internal/nimillm/`。
- Local 执行路径：`runtime/internal/services/localservice/`。

## 4. 非目标

- 不在 domain 文档定义本地规则号。
- 不在本文件维护执行策略和测试快照。
