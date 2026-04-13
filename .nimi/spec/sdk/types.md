# SDK Types Domain Spec

> Scope: `@nimiplatform/sdk/types` 共享类型导引。
> Normative Imports: `.nimi/spec/sdk/kernel/*`

## 0. 权威导入

- `kernel/surface-contract.md`（S-SURFACE-001, S-SURFACE-004）
- `kernel/error-projection.md`（S-ERROR-001, S-ERROR-010, S-ERROR-013, S-ERROR-014）
- `kernel/tables/sdk-surfaces.yaml`

## 1. 文档定位

本文件定义 `@nimiplatform/sdk/types` 子路径的阅读边界。规范条款由 sdk kernel 定义；本 domain 文档只负责说明共享类型导出的角色，不复制类型细节。

## 2. 子路径职责

- 共享运行时无关的 value/type 导出，如 `NimiError`、`ScopeName`、`ExternalPrincipalId`。
- 作为其他 SDK 子路径的稳定类型入口，不承载 transport/client facade。
- 命名与错误族必须与 `S-SURFACE-001`、`S-ERROR-010`、`S-ERROR-013`、`S-ERROR-014` 保持一致，不引入本地别名层。

## 3. 非目标

- 不在本文件定义额外规则编号。
- 不在 domain 文档维护实现态类型清单。
