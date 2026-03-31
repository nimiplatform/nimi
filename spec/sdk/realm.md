# Realm SDK Domain Spec

> Scope: `@nimiplatform/sdk/realm` 主题导引（实例隔离、刷新策略、实时边界）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- `kernel/realm-contract.md`（S-REALM-010, S-REALM-011, S-REALM-012, S-REALM-013, S-REALM-014, S-REALM-015, S-REALM-019, S-REALM-027, S-REALM-028, S-REALM-029, S-REALM-031, S-REALM-035, S-REALM-036, S-REALM-037, S-REALM-038）
- `kernel/surface-contract.md`（S-SURFACE-004, S-SURFACE-005, S-SURFACE-006, S-SURFACE-007, S-SURFACE-008, S-SURFACE-010）
- `kernel/transport-contract.md`（S-TRANSPORT-004, S-TRANSPORT-006）
- `kernel/error-projection.md`（S-ERROR-001, S-ERROR-005, S-ERROR-011, S-ERROR-013, S-ERROR-014）
- `kernel/boundary-contract.md`（S-BOUNDARY-004）
- `kernel/tables/sdk-realm-realtime-gates.yaml`

## 1. 文档定位

本文件是 realm 子路径导引。实例边界、命名规范、请求与实时语义以 sdk kernel 为权威。

## 2. 阅读路径

1. realm 主合同：`kernel/realm-contract.md`。
2. 公开导出与命名规范：`kernel/surface-contract.md`。
3. 传输与可观测性：`kernel/transport-contract.md`。
4. 错误码族与投影：`kernel/error-projection.md` + `sdk-error-codes.yaml`。

## 3. 关联材料

- Companion：`kernel/companion/realm-runtime-behavior-guide.md`。
- realm 子路径实现：`sdk/src/realm/`。
- OpenAPI 生成产物：`sdk/src/realm/generated/`。

实例隔离与鉴权边界在 domain 层必须继续保持可追溯：

- `S-REALM-010` / `S-REALM-011`: endpoint、token、header 与 request engine 配置都只能停留在实例作用域，不能写入全局 OpenAPI 运行态。
- `S-SURFACE-005`: 公开 realm 命名必须去 legacy；允许保留 wire literal，但不允许把 legacy 名称继续暴露为稳定 SDK 符号。
- `S-SURFACE-006`: app 生产代码不能绕过 typed realm surface 去直连 `/api/...`；任何例外都必须收敛到显式 allowlist。
- `S-SURFACE-007`: 未覆盖的底层请求只能走显式 `unsafeRaw` 命名，不能回流 `realm.raw` 兼容别名。
- `S-SURFACE-008` / `S-SURFACE-010`: app-facing Realm DTO 必须保持具名可消费；真正动态对象必须进入显式 allowlist，而不是让业务结构长期停留在匿名 envelope。
- `S-REALM-012` / `S-REALM-013`: endpoint 或 token 缺失时必须 fail-close；refresh 策略必须显式声明，不允许隐式后台刷新。
- `S-REALM-015`: 认证失败最多单次重试，且必须留痕可观测。
- `S-REALM-031`: 401/403/429/5xx 不能伪装成成功响应。
- `S-ERROR-011`: ExternalPrincipal proof 相关错误码（如 `AUTH_TOKEN_EXPIRED`、`AUTH_UNSUPPORTED_PROOF_TYPE`）是不可重试根因。
- `S-ERROR-013` / `S-ERROR-014`: realm transport 产出的结构化错误必须按统一优先级归一化，并与其他 transport 保持等价字段形状。

## 4. 非目标

- 不在本文件维护字段级请求清单。
- 不在 domain 层定义额外规则编号。
