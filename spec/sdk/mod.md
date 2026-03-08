# Mod SDK Domain Spec

> Scope: `@nimiplatform/sdk/mod` 主题导引（host 注入、hook 聚合、跨域边界）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- `kernel/mod-contract.md`（S-MOD-001, S-MOD-002, S-MOD-003, S-MOD-010, S-MOD-011）
- `kernel/surface-contract.md`（S-SURFACE-004）
- `kernel/transport-contract.md`（S-TRANSPORT-003）
- `kernel/error-projection.md`（S-ERROR-003）
- `kernel/boundary-contract.md`（S-BOUNDARY-003, S-BOUNDARY-004）

## 1. 文档定位

本文件是 mod 子路径导引。host 注入语义、hook 聚合边界与导入约束由 sdk kernel 定义。

## 2. 阅读路径

1. 主合同：`kernel/mod-contract.md`。
2. 稳定导出面：`kernel/surface-contract.md`。
3. 订阅与重建约束：`kernel/transport-contract.md`。
4. 边界规则：`kernel/boundary-contract.md`。

## 3. 跨层关联

- Desktop hook 能力模型：`spec/desktop/kernel/hook-capability-contract.md`。
- Runtime app messaging：`spec/runtime/kernel/app-messaging-contract.md`。
- Local image workflow host projection：mod 通过 host-injected facade 请求 `runtime.local.artifacts.list`，并用 `buildLocalImageWorkflowExtensions()` 组装 `components` 与 `profile_overrides`。

## 4. 非目标

- 不在 domain 层定义 mod 执行内核规则。
- 不在本文件维护运行态授权策略。
