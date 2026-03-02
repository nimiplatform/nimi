# Multimodal Delivery Gates Domain Spec

> Status: Active
> Date: 2026-03-01
> Scope: 多模态交付门禁体系（G0-G7）——release blocker 定义与验收命令。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

本文件不再重复定义跨域通用契约，统一导入 kernel 规则：

- MediaJob 生命周期：`kernel/media-job-lifecycle.md`（`K-JOB-*`）
- Provider 健康：`kernel/provider-health-contract.md`（`K-PROV-*`）
- 流式契约：`kernel/streaming-contract.md`（`K-STREAM-*`）
- RPC 面：`kernel/rpc-surface.md`（`K-RPC-*`）
- 错误模型：`kernel/error-model.md`（`K-ERR-*`）
- Workflow：`kernel/workflow-contract.md`（`K-WF-*`）

## 1. 领域不变量

`MMGATE-*` 为多模态交付门禁领域增量规则（非 kernel 通用规则）。

- `MMGATE-001`: 每个 Gate 必须有"输入、输出、验证命令、退出条件"，缺任一项不得纳入门禁体系。
- `MMGATE-002`: 任何 Gate 失败都不能进入下一 Gate，门禁严格串行。
- `MMGATE-003`: 代码、协议、测试、文档必须同轮闭环，不允许"代码先行、合同后补"。
- `MMGATE-004`: 所有验收证据必须可在 CI 重放，不允许"手工验证通过但 CI 不可验证"。
- `MMGATE-005`: 执行态记录（日期化证据、PASS/FAIL 快照）必须写入 `dev/report/*`，不得直接写入 SSOT 或 spec。

## 2. 需求总清单

| ID | 需求 | 关联 Kernel 规则 | 证据类型 |
|---|---|---|---|
| MM-REQ-001 | Canonical 多模态字段 | `K-RPC-002`（AIService 方法集合） | proto diff + contract test |
| MM-REQ-002 | `provider_options` 扩展能力 | `K-RPC-002` | adapter test |
| MM-REQ-003 | 媒体 async job 一等公民语义 | `K-JOB-001`–`K-JOB-006`（MediaJob 生命周期） | workflow + ai e2e |
| MM-REQ-004 | Artifact 元数据扩展 | `K-JOB-001`（GetMediaResult） | artifact contract test |
| MM-REQ-005 | LocalAI 完整 adapter + matrix | `K-PROV-002`（探测目标 `local`） | localruntime test + health test |
| MM-REQ-006 | Nexa 真实运行链路与门控 | `K-PROV-002`（探测目标 `local-nexa`） | integration test |
| MM-REQ-007 | nimiLLM 稳定路由与健康回退 | `K-PROV-001`（健康状态机）、`K-PROV-003`（探测策略） | ai/provider tests |
| MM-REQ-008 | nimiLLM 核心 provider 覆盖完整 | `K-PROV-006`（探测目标映射） | provider contract tests |
| MM-REQ-009 | Workflow external async 节点语义 | `K-WF-005`（Workflow 契约） | workflow e2e |
| MM-REQ-010 | 跨 provider x modality 测试矩阵 | `K-PROV-002`、`K-ERR-001` | matrix report |
| MM-REQ-011 | 覆盖率门禁升级 | 本文件 | CI gate |
| MM-REQ-012 | 审计与可观测字段完整 | `K-PROV-004`（健康联动）、`K-STREAM-001`（流模式分类） | audit assertions |

## 3. Gate 总览

| Gate | 目标 | 通过后产物 |
|---|---|---|
| G0 | SSOT 冻结 | 合同文档可执行且互相引用一致 |
| G1 | Proto 完整表达 | 新 proto 字段/RPC + buf 校验通过 |
| G2 | SDK 完整映射 | SDK 输入模型与 proto 对齐 |
| G3 | Runtime provider 适配 | LocalAI/Nexa/nimiLLM 全链路可调用 |
| G4 | Workflow async 编排 | external async DAG 闭环可运行 |
| G5 | 测试矩阵达标 | provider x modality 矩阵测试报告 |
| G6 | 可观测与可靠性达标 | 审计、健康、超时、降级语义完整 |
| G7 | 发布候选门禁 | 所有 Gate 证据归档并可复现 |

## 4. Gate 细则

### G0：SSOT 冻结门

- `MMGATE-010`: 合同无互相冲突条款。"最小子集"口径被替换为 canonical + async job 口径。
- `MMGATE-011`: 每条强约束都有归属文档与验收证据类型。

退出条件：架构评审通过（记录在 PR），文档链接与引用均可解析。

### G1：Proto 门

输入：`proto/runtime/v1/ai.proto`、`proto/runtime/v1/workflow.proto`。

- `MMGATE-020`: 多模态 canonical 字段可表达（对齐 `K-RPC-002` AIService 方法集合）。
- `MMGATE-021`: async job RPC 完整（`K-JOB-001` SubmitMediaJob/GetMediaJob/CancelMediaJob/SubscribeMediaJobEvents/GetMediaResult）。
- `MMGATE-022`: Artifact 元数据可表达。
- `MMGATE-023`: 向后兼容策略明确（新增不破坏旧接口）。

验证命令：`cd proto && buf lint && buf breaking --against ../runtime/proto/runtime-v1.baseline.binpb && buf generate`。

退出条件：Buf 全绿，生成代码无 diff 漂移。

### G2：SDK 门

- `MMGATE-030`: video/tts/stt/image 输入与 canonical 对齐。
- `MMGATE-031`: async job 能力有 SDK API 映射。

验证命令：`pnpm -r test && pnpm check:sdk-coverage`。

### G3：Runtime Provider 门

- `MMGATE-040`: LocalAI 完整链路可运行（对齐 `K-PROV-002` 探测目标 `local`）。
- `MMGATE-041`: Nexa 完整链路可运行（对齐 `K-PROV-002` 探测目标 `local-nexa`）。
- `MMGATE-042`: nimiLLM 路由、健康（`K-PROV-001` 状态机）、回退语义稳定。
- `MMGATE-043`: 不可支持能力 fail-close（`K-ERR-001` reasonCode 映射）。

验证命令：`cd runtime && go test ./internal/services/ai ./internal/services/localruntime ./internal/daemon ./internal/httpserver`。

### G4：Workflow Async 门

- `MMGATE-050`: external async node 语义完整（submit/poll/cancel/resume），对齐 `K-WF-005`。
- `MMGATE-051`: workflow 事件可见外部任务生命周期。
- `MMGATE-052`: 失败、重试、取消语义可审计。

验证命令：`cd runtime && go test ./internal/services/workflow`。

退出条件：至少 1 条图片/视频任务型 DAG e2e 通过，取消与超时路径测试通过。

### G5：测试矩阵门

- `MMGATE-060`: 矩阵维度覆盖 `provider x modality`、`routePolicy`、`sync/async`、`stream/non-stream`、`success/unsupported/timeout/unavailable`。
- `MMGATE-061`: Runtime service layer statements `>= 60%`。
- `MMGATE-062`: `internal/services/ai` statements `>= 70%`。
- `MMGATE-063`: 媒体核心函数（image/video/tts/stt/async job）函数覆盖 `>= 80%`。

退出条件：矩阵报告无空洞，覆盖率门槛全部达标。

### G6：可观测与可靠性门

- `MMGATE-070`: provider 健康状态可订阅（`K-STREAM-010` 模式 D 长生命周期订阅流）、可审计。
- `MMGATE-071`: route/fallback/auto-switch 有结构化审计字段。
- `MMGATE-072`: timeout/unavailable/content-filter reasonCode 映射稳定（`K-ERR-001`）。
- `MMGATE-073`: 队列等待、任务状态（`K-JOB-002` 终态集合）、artifact 元数据可查询。

验证命令：`cd runtime && go test ./internal/services/audit ./internal/providerhealth ./internal/httpserver ./cmd/nimi`。

### G7：发布候选门

- `MMGATE-080`: G0-G6 全部通过。
- `MMGATE-081`: 变更清单、风险清单、回滚策略齐全。
- `MMGATE-082`: 兼容性声明公开可读。

发布候选命令：

1. `cd runtime && go test ./...`
2. `cd runtime && go run ./cmd/runtime-compliance --gate`
3. `pnpm check:runtime-go-coverage`
4. `pnpm check:sdk-coverage`

## 5. 执行态记录归档

- `MMGATE-090`: 迭代计划、完成状态、PASS/FAIL 快照必须写入 `dev/report/*.md`，不得直接写入本文件。
- `MMGATE-091`: 每轮 Gate 执行必须在 `dev/report` 产出结果摘要与证据明细。
- `MMGATE-092`: 报告最小字段：`gate`、`status`、`commands`、`evidence paths`、`residual risks`。

## 6. 变更控制

- `MMGATE-100`: 任何"降门槛"变更必须单独 PR 并说明风险。
- `MMGATE-101`: 新增 provider 必须补齐本文件 Gate 证据（对齐 `K-PROV-002` 探测目标），不允许"先接入后补测试"。
- `MMGATE-102`: 任何 reasonCode 变更必须同步更新 SSOT、spec 与测试断言。

## 7. 本文件非目标

- 不定义跨域的 JWT 细节与媒体 Job owner 顺序（见 kernel `K-JOB-003` 凭据快照）
- 不定义流式 done 事件契约（见 kernel `K-STREAM-003`/`K-STREAM-004`）
- 不定义 ReasonCode 全值域（见 kernel `K-ERR-*`）
- 不定义 provider 健康状态机（见 kernel `K-PROV-001`）

## 8. 变更规则

修改多模态交付门禁时必须同时满足：

1. 若触及跨域规则，先改 `spec/runtime/kernel/*`
2. 再改本文件的领域增量规则
3. 禁止在本文件新增 kernel 规则副本
