---
title: Nimi Runtime Multimodal Delivery Gates
status: ACTIVE
created_at: 2026-02-26
updated_at: 2026-02-26
parent: service-contract.md
references:
  - ssot/runtime/multimodal-provider-contract.md
  - ssot/runtime/service-contract.md
  - ssot/runtime/proto-contract.md
  - ssot/runtime/local-runtime.md
  - ssot/runtime/workflow-dag.md
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Gates are release blockers; failing any gate blocks multimodal release.
  - Every gate MUST have machine-checkable evidence in CI.
---

# Runtime 多模态交付清单与验收门禁（V1.5）

## 0. 文档定位

本文件定义“多次迭代仍可收敛”的执行清单与门禁体系。  
目标不是阶段性演示，而是确保每轮迭代都有可验证出口，最终完成所有需求。

## 1. 全局规则（MUST）

1. 每个 Gate 必须有“输入、输出、验证命令、退出条件”。
2. 任何 Gate 失败都不能进入下一 Gate。
3. 代码、协议、测试、文档必须同轮闭环，不允许“代码先行、合同后补”。
4. 所有验收证据必须可在 CI 重放。
5. 不允许“手工验证通过但 CI 不可验证”。

## 2. 需求总清单（可追踪）

| ID | 需求 | 归属文档 | 证据类型 |
|---|---|---|---|
| MM-REQ-001 | Canonical 多模态字段（image/video/tts/stt） | `multimodal-provider-contract.md` | proto diff + contract test |
| MM-REQ-002 | `provider_options` 扩展能力 | `multimodal-provider-contract.md` | adapter test |
| MM-REQ-003 | 媒体 async job 一等公民语义 | `multimodal-provider-contract.md` | workflow + ai e2e |
| MM-REQ-004 | Artifact 元数据扩展 | `multimodal-provider-contract.md` | artifact contract test |
| MM-REQ-005 | LocalAI 完整 adapter + matrix | `local-runtime.md` | localruntime test + health test |
| MM-REQ-006 | Nexa 真实运行链路与门控 | `local-runtime.md` + `providers/nexa.md` | integration test |
| MM-REQ-007 | LiteLLM 稳定路由与健康回退 | `service-contract.md` | ai/provider tests |
| MM-REQ-008 | 非兼容 provider custom adapter | `multimodal-provider-contract.md` | adapter contract tests |
| MM-REQ-009 | Workflow external async 节点语义 | `workflow-dag.md` | workflow e2e |
| MM-REQ-010 | 跨 provider x modality 测试矩阵 | `multimodal-provider-contract.md` | matrix report |
| MM-REQ-011 | 覆盖率门禁升级 | 本文件 | CI gate |
| MM-REQ-012 | 审计与可观测字段完整 | `service-contract.md` | audit assertions |

## 3. Gate 总览

| Gate | 目标 | 通过后产物 |
|---|---|---|
| G0 | SSOT 冻结 | 合同文档可执行且互相引用一致 |
| G1 | Proto 完整表达 | 新 proto 字段/RPC + buf 校验通过 |
| G2 | SDK 完整映射 | SDK 输入模型与 proto 对齐 |
| G3 | Runtime provider 适配 | LocalAI/Nexa/LiteLLM/custom adapter 全链路可调用 |
| G4 | Workflow async 编排 | external async DAG 闭环可运行 |
| G5 | 测试矩阵达标 | provider x modality 矩阵测试报告 |
| G6 | 可观测与可靠性达标 | 审计、健康、超时、降级语义完整 |
| G7 | 发布候选门禁 | 所有 Gate 证据归档并可复现 |

## 4. Gate 细则

### G0：SSOT 冻结门

输入：

1. `service-contract.md`
2. `proto-contract.md`
3. `multimodal-provider-contract.md`
4. `multimodal-delivery-gates.md`

必须满足：

1. 合同无互相冲突条款。
2. “最小子集”口径被替换为 canonical + async job 口径。
3. 每条强约束都有归属文档与验收证据类型。

退出条件：

1. 架构评审通过（记录在 PR）。
2. 文档链接与引用均可解析。

### G1：Proto 门

输入：

1. `proto/runtime/v1/ai.proto`
2. `proto/runtime/v1/workflow.proto`
3. 必要时新增 `media_job.proto` 或等价定义

必须满足：

1. 多模态 canonical 字段可表达。
2. async job RPC 完整。
3. Artifact 元数据可表达。
4. 向后兼容策略明确（新增不破坏旧接口）。

验证命令（CI 必跑）：

1. `cd proto && buf lint`
2. `cd proto && buf breaking --against ../runtime/proto/runtime-v1.baseline.binpb`
3. `cd proto && buf generate`（零漂移）

退出条件：

1. Buf 全绿。
2. 生成代码无 diff 漂移。

### G2：SDK 门

输入：

1. `sdk/src/ai-provider/*`
2. `sdk/src/runtime/generated/*`

必须满足：

1. video/tts/stt/image 输入与 canonical 对齐。
2. async job 能力有 SDK API 映射。
3. 旧签名保留兼容窗口（如保留则必须标记 deprecated）。

验证命令：

1. `pnpm -r test`
2. `pnpm check:sdk-coverage`
3. 增加 `sdk/test/ai-provider` 对新字段与错误路径测试

退出条件：

1. SDK 测试与 coverage gate 通过。
2. 新旧签名行为一致性测试通过。

### G3：Runtime Provider 门

输入：

1. `runtime/internal/services/ai/*`
2. `runtime/internal/services/localruntime/*`
3. provider-specific adapter 代码

必须满足：

1. LocalAI 完整链路可运行（非仅配置）。
2. Nexa 完整链路可运行（非仅 proto hints）。
3. LiteLLM 路由、健康、回退语义稳定。
4. 非兼容 provider 通过 custom adapter 接入。
5. 不可支持能力 fail-close。

验证命令：

1. `cd runtime && go test ./internal/services/ai ./internal/services/localruntime ./internal/daemon ./internal/httpserver`
2. provider adapter 合同测试（新增）
3. 健康探针与 route.auto_switch 审计测试

退出条件：

1. 所有 provider 合同测试通过。
2. 不存在“伪成功回退”路径。

### G4：Workflow Async 门

输入：

1. `runtime/internal/services/workflow/*`
2. `proto/runtime/v1/workflow.proto`

必须满足：

1. external async node 语义完整（submit/poll/cancel/resume）。
2. workflow 事件可见外部任务生命周期。
3. 失败、重试、取消语义可审计。

验证命令：

1. `cd runtime && go test ./internal/services/workflow`
2. workflow + ai 联合 e2e（新增）

退出条件：

1. 至少 1 条图片/视频任务型 DAG e2e 通过。
2. 取消与超时路径测试通过。

### G5：测试矩阵门

必须产出矩阵报告（PR 附件）：

1. `provider x modality`
2. `routePolicy`
3. `sync/async`
4. `stream/non-stream`
5. `success/unsupported/timeout/unavailable`

本轮报告：

1. `dev/report/runtime-multimodal-g3-g5-matrix-2026-02-26-r4.md`
2. `dev/report/runtime-multimodal-g3-g5-matrix-2026-02-26-r4.evidence.md`

覆盖率门槛（必须上调）：

1. Runtime service layer（`runtime/internal/services/...`）statements `>= 60%`
2. `internal/services/ai` statements `>= 70%`
3. 媒体核心函数（image/video/tts/stt/async job）函数覆盖 `>= 80%`

退出条件：

1. 矩阵报告无空洞（不允许“未测”）。
2. 覆盖率门槛全部达标。

### G6：可观测与可靠性门

必须满足：

1. provider 健康状态可订阅、可审计。
2. route/fallback/auto-switch 有结构化审计字段。
3. timeout / unavailable / content-filter reasonCode 映射稳定。
4. 队列等待、任务状态、artifact 元数据可查询。

验证命令：

1. `cd runtime && go test ./internal/services/audit ./internal/providerhealth ./internal/httpserver ./cmd/nimi`

退出条件：

1. 审计字段断言测试通过。
2. 健康与事件流断言测试通过。

### G7：发布候选门

必须满足：

1. G0-G6 全部通过。
2. 变更清单、风险清单、回滚策略齐全。
3. 兼容性声明（支持范围与不支持范围）公开可读。

发布候选命令：

1. `cd runtime && go test ./...`
2. `go run ./runtime/cmd/runtime-compliance --gate`
3. `pnpm check:runtime-go-coverage`（阈值已提升）
4. `pnpm check:sdk-coverage`

退出条件：

1. 全部命令成功。
2. 发布说明包含矩阵报告与已知限制。

## 5. 迭代执行模板（每轮必填）

每次迭代必须更新以下模板：

| Iteration | 目标 Gate | 计划完成日期 | 实际完成日期 | 未完成项 | 阻塞原因 | 下轮承接 |
|---|---|---|---|---|---|---|
| I1 | G1 + G2（协议与 SDK 映射） | 2026-02-26 | 2026-02-26 | 无 | 无 | I2 provider 实链 |
| I2 | G3（provider 实链与 fail-close） | 2026-02-26 | 2026-02-26 | 无 | 无 | I3 async workflow + matrix |
| I3 | G4 + G5（external-async + 矩阵 + coverage gate） | 2026-02-26 | 2026-02-26 | G6/G7 发布件待后续轮次 | 非本轮目标范围 | 发布候选与对外文档化 |

## 6. 变更控制（MUST）

1. 任何“降门槛”变更必须单独 PR 并说明风险。
2. 新增 provider 必须补齐本文件 Gate 证据，不允许“先接入后补测试”。
3. 任何 reasonCode 变更必须同步更新 SSOT 与测试断言。
