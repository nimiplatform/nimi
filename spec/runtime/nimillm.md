# nimiLLM Remote Execution Spec

> Scope: remote 执行主题导引（provider 适配、流式语义、ScenarioJob 关联）。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

- `kernel/nimillm-contract.md`（K-NIMI-001, K-NIMI-003, K-NIMI-006, K-NIMI-008, K-NIMI-010）
- `kernel/rpc-surface.md`（K-RPC-002）
- `kernel/key-source-routing.md`（K-KEYSRC-002, K-KEYSRC-004）
- `kernel/endpoint-security.md`（K-SEC-001, K-SEC-004）
- `kernel/tables/provider-catalog.yaml`（provider canonical set / endpoint 默认值）
- `kernel/tables/provider-capabilities.yaml`（provider runtime_plane / execution_module 能力约束）
- `kernel/scenario-job-lifecycle.md`（K-JOB-001, K-JOB-006）
- `kernel/streaming-contract.md`（K-STREAM-002, K-STREAM-003, K-STREAM-004）
- `kernel/error-model.md`（K-ERR-001, K-ERR-004）
- `kernel/audit-contract.md`（K-AUDIT-001, K-AUDIT-018）

## 1. 文档定位

本文件只提供 nimillm 主题导航。provider 路由、错误语义、流式与任务语义均以 kernel 规则为准。

## 2. 阅读路径

1. nimillm 主合同：`kernel/nimillm-contract.md`。
2. 请求评估与路由：`kernel/key-source-routing.md`。
3. 出站安全：`kernel/endpoint-security.md`。
4. provider 值域与执行平面：`kernel/tables/provider-catalog.yaml` + `kernel/tables/provider-capabilities.yaml`。
5. 流式与任务：`kernel/streaming-contract.md` + `kernel/scenario-job-lifecycle.md`。

## 3. 模块映射

- nimillm 实现：`runtime/internal/nimillm/`。
- AI service 汇聚：`runtime/internal/services/ai/`。
- Connector service 协同：`runtime/internal/services/connector/`。

## 4. 非目标

- 不在 domain 层定义 provider 规则或错误码枚举。
- 不在本文件维护实现级接口签名清单。
