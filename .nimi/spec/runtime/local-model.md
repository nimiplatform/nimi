# Local Model Execution Spec

> Scope: 本地模型执行主题导引（logical model、resolved bundle、engine-first 路由、生命周期）。
> Normative Imports: `.nimi/spec/runtime/kernel/*`

## 0. 权威导入

- `kernel/rpc-surface.md`（K-RPC-002）
- `kernel/local-category-capability.md`（category/capability：K-LOCAL-001~004；install/lifecycle：K-LOCAL-005~006, K-LOCAL-009~016；三层抽象与绑定：K-LOCAL-007~008；adapter/routing：K-LOCAL-017~020；catalog/search：K-LOCAL-011, K-LOCAL-014a, K-LOCAL-021a~021e, K-LOCAL-021~028；health recovery：K-LOCAL-022；audit/pagination：K-LOCAL-029~030）
- `kernel/local-engine-contract.md`（K-LENG-001, K-LENG-011）
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
3. 流式事件语义：`kernel/streaming-contract.md`。
4. 本地引擎与适配事实源：`kernel/tables/local-engine-catalog.yaml`、`kernel/tables/local-adapter-routing.yaml`。
5. 逻辑模型、resolved bundle 与安装生命周期：`kernel/local-category-capability.md`（K-LOCAL-007~016）。
6. engine-first 路由与 `model_id` 前缀路由：`kernel/local-category-capability.md`（K-LOCAL-017~020）。
7. catalog 搜索、HuggingFace 获取与存储布局：`kernel/local-category-capability.md`（K-LOCAL-011, K-LOCAL-021~028）。
8. 审计扩展与分页边界：`kernel/local-category-capability.md`（K-LOCAL-029, K-LOCAL-030）。
9. unhealthy 恢复策略：`kernel/local-category-capability.md`（K-LOCAL-022）。

## 3. 模块映射

- Local service（含统一 `LocalAsset*`、bundle/health/warm 元数据持久化）：`runtime/internal/services/localservice/`。
- 引擎抽象：`runtime/internal/engine/`。
- 统一模型视图：`runtime/internal/services/model/`、`runtime/internal/modelregistry/`。
- 审计与错误映射：`runtime/internal/services/audit/`、`runtime/internal/errors/`。

## 4. 非目标

- 不在 domain 层定义本地执行状态机细则。
- 不在本文件维护测试矩阵与执行态证据。
