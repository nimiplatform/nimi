# nimiLLM Remote Execution Spec

> Status: Draft
> Date: 2026-02-28
> Scope: runtime 内部 `nimillm` 模块（remote 执行）的职责、边界、内部接口与 provider 适配规则。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

`nimillm` 不再重复定义以下通用契约，统一引用 kernel：

- RPC 名称权威：`kernel/rpc-surface.md` (`K-RPC-*`)
- 鉴权/owner/信息隐藏：`kernel/authz-ownership.md` (`K-AUTH-*`)
- key-source 与评估顺序：`kernel/key-source-routing.md` (`K-KEYSRC-*`)
- endpoint 安全：`kernel/endpoint-security.md` (`K-SEC-*`)
- 流式契约：`kernel/streaming-contract.md` (`K-STREAM-*`)
- 错误模型：`kernel/error-model.md` (`K-ERR-*`)
- MediaJob 生命周期：`kernel/media-job-lifecycle.md` (`K-JOB-*`)
- 审计字段最小集：`kernel/audit-contract.md` (`K-AUDIT-*`)

## 1. 模块定位

- `NIMI-001`: `nimillm` 是 runtime 的 remote 执行模块。
- `NIMI-002`: 只处理两类目标：
  - managed remote（`connector_id` 指向 `REMOTE_MANAGED`）
  - inline remote（`x-nimi-key-source=inline`）
- `NIMI-003`: 不处理 `LOCAL_MODEL` 执行。
- `NIMI-004`: 不承担 connector CRUD、JWT 校验、CredentialStore 持久化职责。

## 2. 上游调用分工

- `services/ai`：调用执行路径（Generate/StreamGenerate/Embed/Media/TTS）
- `ConnectorService`：调用发现与探测路径（ListConnectorModels(remote)/TestConnector(remote)）

`NIMI-010`: 入口互斥校验由上游按 `K-KEYSRC-*` 执行，`nimillm` 不重建第二套入口规则。

## 3. 内部接口（实现层）

以下为实现层接口命名，非对外 gRPC 名称：

```go
type Module struct {}

func (m *Module) GenerateText(ctx context.Context, target RemoteTarget, req TextRequest) (string, *UsageSummary, FinishReason, error)
func (m *Module) StreamGenerateText(ctx context.Context, target RemoteTarget, req TextRequest, cb StreamCallback) (*UsageSummary, FinishReason, error)
func (m *Module) Embed(ctx context.Context, target RemoteTarget, req EmbedRequest) ([]*structpb.ListValue, *UsageSummary, error)
func (m *Module) SubmitMediaJob(ctx context.Context, target RemoteTarget, req MediaSubmitRequest) (*MediaJob, error)
func (m *Module) GetMediaJob(ctx context.Context, target RemoteTarget, jobID string) (*MediaJob, error)
func (m *Module) CancelMediaJob(ctx context.Context, target RemoteTarget, jobID string) (*MediaJob, error)
func (m *Module) SubscribeMediaJobEvents(ctx context.Context, target RemoteTarget, jobID string) (<-chan MediaJobEvent, error)
func (m *Module) GetMediaResult(ctx context.Context, target RemoteTarget, jobID string) (*MediaResult, error)
func (m *Module) SynthesizeSpeechStream(ctx context.Context, target RemoteTarget, req SpeechStreamRequest, cb AudioChunkCallback) (*TTSUsageSummary, error)

func (m *Module) ListRemoteModels(ctx context.Context, target RemoteTarget, forceRefresh bool) ([]ModelDescriptor, error)
func (m *Module) TestRemoteEndpoint(ctx context.Context, target RemoteTarget, timeout time.Duration) (ProbeResult, error)
```

`NIMI-020`: 内部命名与对外 gRPC 命名映射必须由上游维护，`nimillm` 不导出 gRPC 方法名常量。

## 4. Provider 适配

## 4.1 provider_type 白名单

`nimillm` 的 provider_type 值域以 `kernel/tables/provider-catalog.yaml` 为权威；
provider 到执行模块/入口模式（managed vs inline）的映射以 `kernel/tables/provider-capabilities.yaml` 为权威。

## 4.2 适配分层

- `NIMI-030`: 先按 `provider_type` 选 backend family。
- `NIMI-031`: 同 provider family 内允许 channel 分流（例如 `volcengine` 多通道）。
- `NIMI-032`: 禁止跨 provider 自动 fallback。

## 4.3 model_id 前缀校验执行责任

`NIMI-040`: `AI_MODEL_PROVIDER_MISMATCH` 的校验逻辑在 `nimillm` 执行，但规则定义权在 `K-ERR-*` + `K-KEYSRC-*`。

## 5. 发现与探测职责

- `NIMI-050`: `ListRemoteModels` 返回完整模型快照给 `ConnectorService`；分页与 token 在 `ConnectorService` 边界执行（见 `K-PAGE-*`）。
- `NIMI-051`: `TestRemoteEndpoint` 诊断失败统一返回 `ProbeResult{ok=false, reason_code=*}`，仅模块自身致命异常返回非 nil error。
- `NIMI-052`: `ListRemoteModels` 的 provider 上游失败在 `ConnectorService` 出口按 `K-ERR-005` 统一映射。

## 6. MediaJob 查询/控制接口约束

`NIMI-060`: `GetMediaJob/CancelMediaJob/SubscribeMediaJobEvents/GetMediaResult` 的 `RemoteTarget` 由上游从 job 快照构造，不依赖当前 connector。

`NIMI-061`: 快照凭据失效时，模块返回 provider auth failed，由上游按 `K-JOB-006` 映射到 job 语义。

## 7. endpoint 安全执行责任

- `NIMI-070`: 所有实际出站调用前都必须执行 `K-SEC-*` 校验。
- `NIMI-071`: Phase 1 不启用私网 allowlist；相关配置字段只能处于关闭态。

## 8. 流式执行责任

- `NIMI-080`: `StreamGenerateText` 与 `SynthesizeSpeechStream` 的回调事件必须满足 `K-STREAM-*`。
- `NIMI-081`: `SubscribeMediaJobEvents` 不使用 `done=true` 终帧模型。

## 9. 审计责任

- `NIMI-090`: `nimillm` 记录执行与探测审计，字段集合遵循 `K-AUDIT-*`。
- `NIMI-091`: `request_id` 缺失时允许在模块边界补全；Phase 1 保持 `request_id==trace_id`。

## 10. 非目标

- 不定义任何 Connector CRUD 行为
- 不定义 JWT/JWKS 刷新策略
- 不定义 LocalRuntime 模型安装与进程编排
- 不定义 SDK 入参体验层 API

## 11. 变更规则

任何涉及以下主题的变更必须先改 kernel：

- 流式阶段边界
- ReasonCode 与 gRPC 语义
- key-source 评估顺序
- endpoint 安全模型

再改 `nimillm` 的实现增量规则。
