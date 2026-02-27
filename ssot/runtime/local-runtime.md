---
title: Nimi Local AI Runtime SSOT
status: ACTIVE
version: v1.4
updated_at: 2026-02-27
rules:
  - local-ai-runtime 的 owner 固定为 desktop execution-plane，禁止将第三方推理主执行链迁回 nimi-realm。
  - Local AI Runtime 依赖抽象固定为 `model -> service -> node`；用户主路径不开放任意节点画布编辑。
  - Setup 安装主路径固定为 `Verified + Hugging Face Catalog` 搜索；安装必须经过 install-plan 解析与确认。
  - `ServiceArtifact` 采用强约束 MUST 规范；service preflight 必须先于大文件下载执行。
  - `dependencies.resolve` 输入必须包含 `deviceProfile`，输出必须包含 selected/reasonCode/warnings。
  - `dependencies.apply` 固定编排为 `preflight(all) -> install artifacts -> bootstrap/start -> health`，不包含跨 Mod 统一能力策略写入。
  - Runtime 必须内置 provider adapter 层（`openai_compat_adapter` + `localai_native_adapter`），节点路由按能力矩阵 fail-close 选择。
  - capability matrix 必须按 `service/provider/node/model/backend/policy` 维度构建，来源固定 `catalog + provider probe + 已安装模型元数据 + provider-specific host probe/policy gate`。
  - `chat/embedding` 默认 `openai_compat_adapter`；`stt/tts/image/video` 默认 `localai_native_adapter`；不匹配时返回 `LOCAL_AI_ADAPTER_MISMATCH`。
  - 模型与服务生命周期写操作由 Core 控制面独占；业务 Mod 仅可声明依赖与消费能力。
  - 路由来源固定为 `local-runtime|token-api`，默认 local-first；fallback 必须显式可见且可审计；全局 Runtime 不维护统一路由策略。
  - Manifest AI 依赖主规范固定为 `ai.dependencies(v2)`；禁止 legacy model packs 字段。
  - runtime 依赖解析以 `mod.manifest.yaml` 为运行时真源，源码 manifest 必须与其保持一致。
  - 本地审计默认开启且不可关闭；云上报默认关闭，需用户显式开启。
  - LocalAI 受管运行硬化必须保持：loopback only + runtime api key + 禁 webui/gallery/runtime settings override/p2p/federated。
---

# Nimi Local AI Runtime 唯一真相（SSOT）

## 1. 目标与边界

Local AI Runtime 域目标：

1. 在 desktop 内提供统一本地 AI 基建，覆盖 catalog、依赖求解、安装、服务托管与审计。
2. 让 Mod 通过稳定能力面消费 AI，不绑定 provider 私有协议。
3. 在 local-first 前提下保留 token-api 受控回退，确保可用性和可治理性并存。

本域边界：

1. 本域拥有：模型与服务供应链、依赖编排、节点能力契约、审计规范。
2. 本域提供路由能力边界（`source/capability` 术语）与健康信号，但不提供跨 Mod 统一能力策略写入。
3. 本域不拥有：社交关系、经济账本、World 治理、Agent 身份语义。
4. nimi-realm 在本域仅为可选 control-plane，不承担第三方推理默认执行宿主。

## 2. 三层依赖抽象（最终态）

### 2.1 抽象定义

| 层 | 对象 | 本质 | 生命周期 |
|---|---|---|---|
| `Model` | `ModelArtifact` | 纯数据资产（weights/tokenizer/config） | `installed -> removed` |
| `Service` | `ServiceArtifact` | 运行时环境 + 进程（python/binary/attached-endpoint） | `installed -> active -> unhealthy -> removed` |
| `Node` | `NodeContract` | typed I/O 能力契约（service 暴露） | `listed`（只读目录） |

补充说明：

1. Workflow DAG 是 runtime 独立编排域，不属于 `ai.dependencies.kind` 候选集合。
2. Mod 依赖声明仅允许 `model|service|node`，跨模型编排走 `runtime.workflow.*`。

### 2.2 Model 与 Service 的强区分

1. Model 只负责文件完整性，不负责进程。
2. Service 负责环境、预检、启动、健康、停止与故障语义。
3. Service 可以绑定一个或多个 Model 作为输入配置。
4. Node 来源于 Service 暴露能力，不直接来源于 Model。

### 2.3 Provider Adapter 与 Capability Matrix

1. Runtime 在 provider 执行层固定支持 `openai_compat_adapter` 与 `localai_native_adapter`。
2. `providerHints` 必须采用 namespace 结构（至少 `localai`，并预留 `nexa`），由 adapter 在 runtime 内部消化。
3. `nodes.catalog.list` 必须返回节点级 `provider/adapter/backend/available/reasonCode/providerHints`。
4. capability matrix 生成必须合并三类证据（provider 需要时扩展 host/policy 证据）：
   - catalog（默认 capability/backend hints）
   - provider probe（`/v1/models`）
   - installed model metadata
5. 矩阵用于 resolve/apply/route/fallback 的统一判定证据，禁止静默降级。

## 3. ServiceArtifact 契约（MUST）

`ServiceArtifact` 必须具备以下字段：

| 字段 | 类型 | 约束 |
|---|---|---|
| `serviceId` | `string` | 全局唯一、稳定标识 |
| `artifactType` | `'python-env' \| 'binary' \| 'attached-endpoint'` | 必填 |
| `install` | `object` | 描述安装输入（requirements/bootstrap/binaryUrl 等） |
| `preflight[]` | `PreflightCheck[]` | 必填，且在下载大文件前执行 |
| `process` | `object` | 描述 entry/args/env/modelBinding |
| `health` | `object` | 描述 endpoint/timeout/interval |
| `nodes[]` | `NodeContract[]` | service 对外能力目录 |

`PreflightCheck` 支持最小集合：

1. `nvidia-gpu`
2. `python-version`
3. `disk-space`
4. `port-available`
5. `dependency-conflict`

每条 preflight 必须返回结构化结果：

1. `ok: boolean`
2. `check: string`
3. `reasonCode: string`
4. `detail: string`

## 4. 依赖求解与执行协议

### 4.1 `dependencies.resolve`（MUST）

输入最小字段：

1. `modId`
2. `capability?`
3. `dependencies`（`required/optional/alternatives/preferred`）
4. `deviceProfile`

`deviceProfile` 最小字段：

1. `os`
2. `arch`
3. `gpu`（vendor/model/available）
4. `python`（version/available）
5. `diskFreeBytes`

输出最小字段：

1. `planId`
2. `dependencies[]`（每项含 `selected`）
3. `reasonCode`
4. `warnings[]`
5. `selectionRationale`（每个 alternatives 组必须可解释）

求解规则：

1. `required` 必须可满足，否则直接失败。
2. `optional` 可跳过，但必须返回跳过原因。
3. `alternatives` 必须按 `preferred -> deviceProfile fit -> default` 确定单选结果。
4. 任何不满足 preflight 的候选不得被选中。

### 4.2 `dependencies.apply`（MUST）

固定编排顺序：

1. `preflight(all dependencies)`  
2. `install artifacts (model + service)`  
3. `bootstrap service runtime`  
4. `start services (provider-managed endpoint first; model lifecycle API not used as service main path)`  
5. `health gates`

失败短路规则：

1. 任一 preflight 失败时，必须终止流程并返回 `reasonCode`，且不得进入大文件下载。
2. 任一健康检查失败时，必须终止流程并标记失败。
3. 所有失败必须可诊断（`reasonCode + detail + dependencyId`）。

## 5. Catalog 与安装主路径

在线来源固定：

1. `Verified`（高可信模板，置顶）
2. `Hugging Face Catalog`（全站搜索，受控放开）

产品主路径固定：

1. `models.catalog.search`
2. `models.catalog.resolveInstallPlan`
3. `models.install*`
4. `models.start`
5. `models.health`
6. `dependency snapshot refresh`

安装计划必须可见：

1. `engine`
2. `engineRuntimeMode`
3. `files/hash`
4. `endpoint`
5. `warnings/reasonCode`

## 6. 路由能力与回退

### 6.1 Route 口径

1. `route source = local-runtime | token-api`
2. `capability = chat | image | video | tts | stt | embedding`
3. 默认策略：`local-first`（由 Mod 在本域能力边界内决策）
4. 全局 Runtime 不维护“跨 Mod 统一路由表”。
5. desktop/mod 的 `token-api` 路径必须使用请求期凭证注入，不得依赖 runtime 启动时全局 API key。
6. host 侧逻辑连接器对应 secret 的轮换应按请求生效；不得把“重启 runtime”作为用户主路径。

### 6.2 回退规则

1. 本地不可用或能力不匹配时，才允许按策略回退 token-api。
2. 回退必须用户可见（UI 状态与修复入口）。
3. 回退必须审计（`fallback_to_token_api` + reasonCode）。

## 7. Mod 接入与 manifest 契约

### 7.1 Manifest AI 声明

1. `ai.consume`：能力摘要。
2. `ai.dependencies(v2)`：依赖真输入（`required/optional/alternatives/preferred`）。
3. legacy model packs 字段：禁用；出现即按协议错误拒绝。

### 7.2 依赖类型

`ai.dependencies` 的 `kind` 仅允许：

1. `model`
2. `service`
3. `node`

约束：

1. Mod 不得直接触发生命周期写命令（`install/remove/start/stop/dependencies.apply`）。
2. runtime 依赖解析以 `mod.manifest.yaml` 为运行时真源。
3. 源码 manifest 与运行时 manifest 语义漂移视为协议违规。

## 8. Desktop Runtime API（稳定能力面）

1. `models.list`
2. `models.catalog.search`
3. `models.catalog.resolveInstallPlan`
4. `dependencies.resolve`
5. `dependencies.apply`
6. `services.list`
7. `services.install`
8. `services.start`
9. `services.stop`
10. `services.health`
11. `services.remove`
12. `nodes.catalog.list`（只读）
13. `models.install`
14. `models.installVerified`
15. `models.import`
16. `models.remove`
17. `models.start`
18. `models.stop`
19. `models.health`
20. `audits.list`

权限边界：

1. `models.*` 与 `services.*` 写操作只允许 Core 调用。
2. Mod 仅可通过 `@nimiplatform/sdk/mod/ai` 消费能力，不得直连 provider 私有 endpoint。

## 9. 审计与诊断

### 9.1 默认策略

1. `local audit = on`（不可关闭）
2. `cloud export = off`（需用户显式开启）

### 9.2 必须记录的事件

1. `model_catalog_search_invoked`
2. `model_catalog_search_failed`
3. `model_download_started`
4. `model_download_completed`
5. `model_download_failed`
6. `engine_pack_download_started`
7. `engine_pack_download_completed`
8. `engine_pack_download_failed`
9. `dependency_resolve_invoked`
10. `dependency_resolve_failed`
11. `dependency_apply_started`
12. `dependency_apply_completed`
13. `dependency_apply_failed`
14. `service_install_started`
15. `service_install_completed`
16. `service_install_failed`
17. `node_catalog_listed`
18. `runtime_model_ready_after_install`
19. `inference_invoked`
20. `inference_failed`
21. `fallback_to_token_api`

### 9.3 payload 必填键（MUST）

| 事件 | 必填 payload |
|---|---|
| `dependency_resolve_*` | `modId/capability/deviceProfile/reasonCode` |
| `dependency_apply_*` | `modId/planId/dependencyCount/reasonCode` |
| `service_install_*` | `serviceId/artifactType/engine/reasonCode` |
| `runtime_model_ready_after_install` | `source/capabilities/localModelId` |
| `fallback_to_token_api` | `modId/source/provider/modality/reasonCode/adapter` |

### 9.4 LocalAI reasonCode 最小集合（冻结）

1. `LOCAL_AI_SERVICE_UNREACHABLE`
2. `LOCAL_AI_AUTH_FAILED`
3. `LOCAL_AI_CAPABILITY_MISSING`
4. `LOCAL_AI_PROVIDER_INTERNAL_ERROR`
5. `LOCAL_AI_PROVIDER_TIMEOUT`
6. `LOCAL_AI_ADAPTER_MISMATCH`

## 10. 产品可见性要求

1. Setup 必须把 Catalog 搜索作为主入口，Advanced 手填作为兜底。
2. Setup 必须展示依赖解析预览与可解释选择结果。
3. 安装后必须即时生效并可见“模型已就绪”状态。
4. Diagnostics 必须支持按事件类型过滤并导出。
5. local-chat 首次回退必须给出跳转 Runtime Setup 的修复入口。

## 11. 非目标

1. 不引入 ComfyUI 式用户可编辑节点画布。
2. 不放开 Mod 生命周期写权限。
3. 不把第三方推理主执行链迁移到 nimi-realm。

## 12. 与其他文档关系

1. Runtime 不可变边界见 `docs/L0-protocols/runtime-execution.md`。
2. Runtime 语义对象见 `docs/L1-foundation/runtime-execution.md`。
3. Mod 接入边界见 `ssot/mod/governance.md`。
4. 跨域总语义见 `ssot/platform/ai-last-mile.md`。
5. 多厂商多模态 canonical 合同见 `ssot/runtime/multimodal-provider-contract.md`。
6. 多轮迭代验收门禁见 `ssot/runtime/multimodal-delivery-gates.md`。
