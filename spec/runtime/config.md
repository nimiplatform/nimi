# Runtime Config Domain Spec

> Status: Active
> Date: 2026-03-03
> Scope: Runtime 配置读取、路径约束、生效语义与跨端调用边界。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

- `kernel/config-contract.md`（K-CFG-001, K-CFG-002, K-CFG-005, K-CFG-006, K-CFG-009）
- `kernel/daemon-lifecycle.md`（K-DAEMON-002, K-DAEMON-009）
- `kernel/provider-health-contract.md`（K-PROV-005）
- `kernel/error-model.md`（K-ERR-001）

## 1. 文档定位

本文件是 runtime-config 主题导引。配置字段定义、优先级、默认值与错误语义以 kernel 为准。

## 2. 关键阅读路径

1. 配置主合同：`kernel/config-contract.md`。
2. daemon 配置装配：`kernel/daemon-lifecycle.md`。
3. provider 命名约束：`kernel/provider-health-contract.md`。
4. 错误映射：`kernel/error-model.md`。

## 3. 模块映射

- Runtime 解析与合并：`runtime/internal/config/`。
- CLI 配置入口：`runtime/cmd/nimi/`。
- Desktop 调用桥：`apps/desktop/src-tauri/src/runtime_bridge/`。

## 4. 非目标

- 不在 domain 层定义配置 schema 细节。
- 不在本文件记录执行态门禁结果。
