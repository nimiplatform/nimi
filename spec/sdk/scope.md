# Scope SDK Domain Spec

> Status: Draft
> Date: 2026-03-03
> Scope: `@nimiplatform/sdk/scope` 主题导引（catalog 生命周期与授权联动边界）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- `kernel/scope-contract.md`（S-SCOPE-001, S-SCOPE-002, S-SCOPE-003, S-SCOPE-004, S-SCOPE-005）
- `kernel/surface-contract.md`（S-SURFACE-004）
- `kernel/transport-contract.md`（S-TRANSPORT-003）
- `kernel/error-projection.md`（S-ERROR-003）
- `kernel/boundary-contract.md`（S-BOUNDARY-001）

## 1. 文档定位

本文件用于 scope 子路径导航。scope 的公开面、错误语义和边界规则以 sdk kernel 为准。

## 2. 阅读路径

1. 主合同：`kernel/scope-contract.md`。
2. Scope 最小稳定面：`kernel/surface-contract.md`。
3. 传输与订阅重建：`kernel/transport-contract.md`。
4. 导入边界：`kernel/boundary-contract.md`。

## 3. 非目标

- 不在 domain 层定义服务端授权规则。
- 不在本文件维护实现态测试条目。
