# Local Model Execution Spec

> Scope: 本地模型执行主题导引（LocalAI/Nexa、引擎、适配路由、生命周期）。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

- `kernel/rpc-surface.md`（K-RPC-002）
- `kernel/local-category-capability.md`（K-LOCAL-001, K-LOCAL-002）
- `kernel/local-engine-contract.md`（K-LENG-001, K-LENG-011）
- `kernel/multimodal-provider-contract.md`（K-MMPROV-016）
- `kernel/device-profile-contract.md`（K-DEV-001）
- `kernel/streaming-contract.md`（K-STREAM-002, K-STREAM-003）
- `kernel/error-model.md`（K-ERR-001）
- `kernel/audit-contract.md`（K-AUDIT-001, K-AUDIT-018）
- `kernel/tables/local-engine-catalog.yaml`
- `kernel/tables/local-adapter-routing.yaml`

## 1. 文档定位

本文件用于连接 local 执行相关 kernel 合同与实现目录。规则定义不在 domain 文档重复。

## 2. 阅读路径

1. category 与 capability：`kernel/local-category-capability.md`。
2. 引擎行为与本地流式：`kernel/local-engine-contract.md`。
3. LocalAI 动态图片工作流与 extension 约束：`kernel/multimodal-provider-contract.md`。
4. 流式事件语义：`kernel/streaming-contract.md`。
5. 本地引擎与适配事实源：`kernel/tables/local-engine-catalog.yaml`、`kernel/tables/local-adapter-routing.yaml`。

## 3. 模块映射

- Local runtime service（含 `LocalArtifact*`、`engine_config` 持久化与 LocalAI 动态 image profile）：`runtime/internal/services/localruntime/`。
- 引擎抽象：`runtime/internal/localengine/`。
- 审计与错误映射：`runtime/internal/services/audit/`、`runtime/internal/errors/`。

## 4. 非目标

- 不在 domain 层定义本地执行状态机细则。
- 不在本文件维护测试矩阵与执行态证据。
