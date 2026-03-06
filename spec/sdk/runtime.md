# Runtime SDK Domain Spec

> Scope: `@nimiplatform/sdk/runtime` 主题导引（构造、连接事件、重试与投影）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- `kernel/runtime-contract.md`（S-RUNTIME-010, S-RUNTIME-015, S-RUNTIME-028, S-RUNTIME-045, S-RUNTIME-050, S-RUNTIME-066）
- `kernel/surface-contract.md`（S-SURFACE-002, S-SURFACE-004）
- `kernel/transport-contract.md`（S-TRANSPORT-001, S-TRANSPORT-002, S-TRANSPORT-005）
- `kernel/error-projection.md`（S-ERROR-001, S-ERROR-006）
- `kernel/boundary-contract.md`（S-BOUNDARY-001, S-BOUNDARY-002）
- `kernel/tables/sdk-runtime-projection.yaml`

## 1. 文档定位

本文件是 runtime 子路径导引。公开方法、连接语义与重试基线由 sdk kernel 定义。

## 2. 阅读路径

1. runtime 主合同：`kernel/runtime-contract.md`。
2. 方法投影来源：`kernel/surface-contract.md` + `runtime-method-groups.yaml`。
3. 传输与版本协商：`kernel/transport-contract.md`。
4. 错误投影与重试语义：`kernel/error-projection.md`。

## 3. 与 runtime kernel 的关系

运行时服务语义来自 `spec/runtime/kernel/*`；SDK 负责协议封装与类型投影。

## 4. 非目标

- 不在本文件定义本地规则体系。
- 不在 domain 文档维护实现态测试清单。
