# Local Model Execution Spec

> Status: Draft
> Date: 2026-02-28
> Scope: runtime 内部 local model 子系统（LocalAI/Nexa）的执行、生命周期与本地审计契约。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

本文件不重复定义通用契约，统一引用 kernel：

- RPC 权威面：`kernel/rpc-surface.md` (`K-RPC-*`)
- 鉴权/owner：`kernel/authz-ownership.md` (`K-AUTH-*`)
- AuthN 验签/JWKS：`kernel/authn-token-validation.md` (`K-AUTHN-*`)
- key-source 与评估顺序：`kernel/key-source-routing.md` (`K-KEYSRC-*`)
- local category/capability：`kernel/local-category-capability.md` (`K-LOCAL-*`)
- endpoint 安全：`kernel/endpoint-security.md` (`K-SEC-*`)
- 流式契约：`kernel/streaming-contract.md` (`K-STREAM-*`)
- 错误模型：`kernel/error-model.md` (`K-ERR-*`)
- 分页过滤：`kernel/pagination-filtering.md` (`K-PAGE-*`)
- 审计字段：`kernel/audit-contract.md` (`K-AUDIT-*`)

## 1. 模块定位

- `LOCAL-001`: local 子系统只处理 `connector.kind=LOCAL_MODEL` 的执行路径。
- `LOCAL-002`: remote 执行统一由 `nimillm` 处理。
- `LOCAL-003`: 入口分流由上游（`services/ai`）执行，local 子系统不实现第二套路由判定。

## 2. 三层抽象（Model -> Service -> Node）

## 2.1 层定义

- Model: 本地模型资产与元数据（weights/config/hash/capabilities）
- Service: 受管进程实例（启动、停止、健康）
- Node: 能力视图（计算态，不持久化）

## 2.2 不变量

- `LOCAL-010`: Phase 1 采用 1:1 绑定（一个 Model 对应一个 Service）。
- `LOCAL-011`: Node 是计算视图，不作为持久化对象。
- `LOCAL-012`: 并发状态变更必须串行（同 `local_model_id` 或 `service_id`）。

## 3. Category 与能力对齐

按 `K-LOCAL-*`：

- `LLM`: `CHAT` + `EMBEDDING`（可带 `VISION` 标记）
- `VISION`: 能力标记，不是独立执行模态
- `IMAGE`/`TTS`/`STT`: 同名模态
- `CUSTOM`: 需 invoke profile（缺失则不可用）

`LOCAL-020`: local connector 固定由系统预设，执行路径按 `model_id` 与能力映射决定。

## 4. Provider 与 Adapter

## 4.1 Phase 1 provider

- LocalAI
- Nexa

`connector.provider` 在 local 路径固定为 `local`（见 `CONN-021`），
其执行能力入口映射以 `kernel/tables/provider-capabilities.yaml` 的 `provider=local` 为权威。

## 4.2 Adapter 决策

- `LOCAL-030`: adapter 决策必须在 runtime 内闭环完成，不依赖 Desktop 侧私有路由逻辑。
- `LOCAL-031`: 本地执行所有请求必须经由 `RuntimeAiService` 的标准 RPC（`K-RPC-002`）。

## 5. 生命周期与编排

## 5.1 生命周期状态（最小）

- model: `installed -> active -> unhealthy -> removed`
- service: `installed -> active -> unhealthy -> removed`

## 5.2 编排步骤

1. preflight
2. artifact install（Phase 1 仅 `binary`）
3. process spawn
4. health probe
5. node catalog refresh

## 5.3 安装载体

`LOCAL-040`: Phase 1 仅实现 `binary` 类型 ServiceArtifact。

## 6. 执行行为

## 6.1 文本/嵌入/媒体/语音

执行入口使用 `K-RPC-002` 的统一 AIService RPC，不引入 local 专属对外推理 RPC 命名。

## 6.2 流式降级（local 专属）

`LOCAL-050`: 当本地 provider 明确不支持流式（例如 404/405/501 或明确错误特征）时，可降级为非流式生成并分片模拟推送。

约束：

- 审计必须标记 `stream_fallback_simulated`
- 终帧 metadata 必须标识 `stream_simulated=true`
- 其余事件语义仍需满足 `K-STREAM-*`

## 7. 健康与诊断

## 7.1 对外探测接口

local 健康与模型可见性通过 `ConnectorService.TestConnector(local)` 与 `ConnectorService.ListConnectorModels(local)` 暴露（见 `K-RPC-003`）。

## 7.2 语义

- `LOCAL-060`: `TestConnector(local)` 的 `ok=true` 表示该 category 至少一个可用模型。
- `LOCAL-061`: 无可用模型时 `ok=false` + 本地原因码（`AI_LOCAL_MODEL_UNAVAILABLE` 或 `AI_LOCAL_MODEL_PROFILE_MISSING`）。

## 8. 审计

`LOCAL-070`: 本地推理与生命周期操作必须写审计，字段集合遵循 `K-AUDIT-*`。

## 9. 错误码使用边界

- 通用跨域错误：使用 `K-ERR-*` 事实源中的全局码（`AI_PROVIDER_*`, `AI_MEDIA_*`, 等）。
- 本地专属错误：仅用于本地执行域（例如本地进程不可达、本地适配失败）。
- 不允许在本文件重新分配全局 ReasonCode 编号。

## 10. 非目标

- 不定义 remote provider 执行逻辑
- 不定义 connector CRUD
- 不定义 JWT/JWKS
- 不定义 SDK 层输入体验

## 11. 变更规则

若变更触及以下跨域主题，必须先改 kernel 再改本文件：

- Local category/capability 语义
- 统一流式 done 规则
- 错误码分层与传递
- 分页排序与过滤
- 审计最小字段
