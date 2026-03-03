# Realm SDK Domain Spec

> Status: Draft
> Date: 2026-03-03
> Scope: `@nimiplatform/sdk/realm` 主题导引（实例隔离、刷新策略、实时边界）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- `kernel/realm-contract.md`（S-REALM-014, S-REALM-019, S-REALM-027, S-REALM-028, S-REALM-029, S-REALM-035, S-REALM-036, S-REALM-037）
- `kernel/surface-contract.md`（S-SURFACE-004, S-SURFACE-005）
- `kernel/transport-contract.md`（S-TRANSPORT-004, S-TRANSPORT-006）
- `kernel/error-projection.md`（S-ERROR-001, S-ERROR-005）
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

## 4. 非目标

- 不在本文件维护字段级请求清单。
- 不在 domain 层定义额外规则编号。
