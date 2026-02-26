---
title: Nimi Runtime Proto Contract
status: FROZEN
created_at: 2026-02-24
updated_at: 2026-02-26
parent: INDEX.md
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Changes must preserve traceability to source and contract-level acceptance gates.
---
---

# Runtime Proto (V1 草案)

## 0. 文档定位（必填）

本文件定义 `nimi-runtime` 的 gRPC 字段级合同与 `.proto` 骨架，目标是让实现团队可直接编码。

- 协议语义真相：`platform/protocol.md`（L0/L1 语义与约束）
- 运行时执行规则：`runtime/service-contract.md`（状态机、审计、治理、默认超时）
- SDK 导入面映射：`sdk/design.md`
- 字段与 service 真相：本文件
- 多模态兼容合同：`ssot/runtime/multimodal-provider-contract.md`
- 多模态交付门禁：`ssot/runtime/multimodal-delivery-gates.md`

V1 全量覆盖范围（9 services）：
- `RuntimeAuthService`
- `RuntimeGrantService`
- `RuntimeAiService`
- `RuntimeWorkflowService`
- `RuntimeModelService`
- `RuntimeKnowledgeService`
- `RuntimeAppService`
- `RuntimeAuditService`
- `RuntimeLocalRuntimeService`

> REF-ERRATA (2026-02-25): 原文写为 8 services，未包含已收口实现的 `RuntimeLocalRuntimeService`；已修正为 9 services。

## 1. 文件布局与命名（必填）

推荐目录：

```text
proto/runtime/v1/
  common.proto
  auth.proto
  ai.proto
  workflow.proto
  model.proto
  local_runtime.proto
  grant.proto
  knowledge.proto
  app.proto
  audit.proto
```

冻结规则：
1. `MUST`：统一使用 `package nimi.runtime.v1;`。
2. `MUST`：文件级 breaking change 通过 Buf 校验，不允许跳过。
3. `MUST`：公共类型只在 `common.proto` 声明，不在子文件重复定义。
4. `MUST`：service 方法名与 `runtime/service-contract.md`/`sdk/design.md` 一致。

## 2. L0 Envelope 与 gRPC 元数据（必填）

L0 字段不进入业务 message body，由 gRPC metadata 承载：

- `x-nimi-protocol-version`
- `x-nimi-participant-protocol-version`
- `x-nimi-participant-id`
- `x-nimi-domain`
- `x-nimi-app-id`
- `x-nimi-trace-id`
- `x-nimi-idempotency-key`
- `x-nimi-caller-kind`（`desktop-core|desktop-mod|third-party-app|third-party-service`）
- `x-nimi-caller-id`
- `x-nimi-surface-id`（可选）

说明：
- SDK 默认自动注入；手写 gRPC 调用方必须显式注入。
- message body 只承载业务字段（如 `app_id/subject_user_id/model_id/...`）。
- 若 metadata `x-nimi-app-id` 与 body `app_id` 同时出现且不一致，`MUST` 拒绝并返回 `PROTOCOL_DOMAIN_FIELD_CONFLICT`。
- `callerKind/callerId/surfaceId` 仅用于归因与可观测，不得作为权限提升信号。

## 3. common.proto（骨架）

```proto
syntax = "proto3";

package nimi.runtime.v1;

enum ReasonCode {
  REASON_CODE_UNSPECIFIED = 0;
  ACTION_EXECUTED = 1;
  PROTOCOL_ENVELOPE_INVALID = 2;
  PROTOCOL_DOMAIN_FIELD_CONFLICT = 3;
  CAPABILITY_CATALOG_MISMATCH = 4;
  APP_NOT_REGISTERED = 5;
  EXTERNAL_PRINCIPAL_NOT_REGISTERED = 6;
  SESSION_EXPIRED = 7;
  PRINCIPAL_UNAUTHORIZED = 8;

  APP_AUTHORIZATION_DENIED = 100;
  APP_GRANT_INVALID = 101;
  APP_TOKEN_EXPIRED = 102;
  APP_TOKEN_REVOKED = 103;
  APP_SCOPE_FORBIDDEN = 104;
  APP_SCOPE_CATALOG_UNPUBLISHED = 105;
  APP_SCOPE_REVOKED = 106;
  APP_DELEGATION_FORBIDDEN = 107;
  APP_DELEGATION_DEPTH_EXCEEDED = 108;
  APP_RESOURCE_SELECTOR_INVALID = 109;
  APP_RESOURCE_OUT_OF_SCOPE = 110;
  APP_CONSENT_MISSING = 111;
  APP_CONSENT_INVALID = 112;
  EXTERNAL_PRINCIPAL_PROOF_MISSING = 113;
  EXTERNAL_PRINCIPAL_PROOF_INVALID = 114;
  APP_MODE_DOMAIN_FORBIDDEN = 115;
  APP_MODE_SCOPE_FORBIDDEN = 116;
  APP_MODE_WORLD_RELATION_FORBIDDEN = 117;
  APP_MODE_MANIFEST_INVALID = 118;

  AI_MODEL_NOT_FOUND = 200;
  AI_MODEL_NOT_READY = 201;
  AI_PROVIDER_UNAVAILABLE = 202;
  AI_PROVIDER_TIMEOUT = 203;
  AI_ROUTE_UNSUPPORTED = 204;
  AI_ROUTE_FALLBACK_DENIED = 205;
  AI_INPUT_INVALID = 206;
  AI_OUTPUT_INVALID = 207;
  AI_STREAM_BROKEN = 208;
  AI_CONTENT_FILTER_BLOCKED = 209;
}

enum ExternalPrincipalType {
  EXTERNAL_PRINCIPAL_TYPE_UNSPECIFIED = 0;
  EXTERNAL_PRINCIPAL_TYPE_AGENT = 1;
  EXTERNAL_PRINCIPAL_TYPE_APP = 2;
  EXTERNAL_PRINCIPAL_TYPE_SERVICE = 3;
}

enum CallerKind {
  CALLER_KIND_UNSPECIFIED = 0;
  CALLER_KIND_DESKTOP_CORE = 1;
  CALLER_KIND_DESKTOP_MOD = 2;
  CALLER_KIND_THIRD_PARTY_APP = 3;
  CALLER_KIND_THIRD_PARTY_SERVICE = 4;
}

message UsageStats {
  int64 input_tokens = 1;
  int64 output_tokens = 2;
  int64 compute_ms = 3;
}

message ResourceSelectors {
  repeated string conversation_ids = 1;
  repeated string message_ids = 2;
  repeated string document_ids = 3;
  map<string, string> labels = 10;
}

message ConsentRef {
  string subject_user_id = 1;
  string consent_id = 2;
  string consent_version = 3;
}

message ErrorInfo {
  ReasonCode reason_code = 1;
  string action_hint = 2;
  string message = 3;
}

message Ack {
  bool ok = 1;
  ReasonCode reason_code = 2;
  string action_hint = 3;
}
```

## 4. ai.proto（骨架）

```proto
syntax = "proto3";

package nimi.runtime.v1;

import "google/protobuf/struct.proto";
import "google/protobuf/timestamp.proto";
import "runtime/v1/common.proto";

enum Modal {
  MODAL_UNSPECIFIED = 0;
  MODAL_TEXT = 1;
  MODAL_IMAGE = 2;
  MODAL_VIDEO = 3;
  MODAL_TTS = 4;
  MODAL_STT = 5;
  MODAL_EMBEDDING = 6;
}

enum RoutePolicy {
  ROUTE_POLICY_UNSPECIFIED = 0;
  ROUTE_POLICY_LOCAL_RUNTIME = 1;
  ROUTE_POLICY_TOKEN_API = 2;
}

enum FallbackPolicy {
  FALLBACK_POLICY_UNSPECIFIED = 0;
  FALLBACK_POLICY_DENY = 1;
  FALLBACK_POLICY_ALLOW = 2;
}

enum FinishReason {
  FINISH_REASON_UNSPECIFIED = 0;
  FINISH_REASON_STOP = 1;
  FINISH_REASON_LENGTH = 2;
  FINISH_REASON_TOOL_CALL = 3;
  FINISH_REASON_CONTENT_FILTER = 4;
  FINISH_REASON_ERROR = 5;
}

enum StreamEventType {
  STREAM_EVENT_TYPE_UNSPECIFIED = 0;
  STREAM_EVENT_STARTED = 1;
  STREAM_EVENT_DELTA = 2;
  STREAM_EVENT_TOOL_CALL = 3;
  STREAM_EVENT_TOOL_RESULT = 4;
  STREAM_EVENT_USAGE = 5;
  STREAM_EVENT_COMPLETED = 6;
  STREAM_EVENT_FAILED = 7;
}

message ChatMessage {
  string role = 1;
  string content = 2;
  string name = 3;
}

message ToolSpec {
  string name = 1;
  google.protobuf.Struct input_schema = 2;
}

message GenerateRequest {
  string app_id = 1;
  string subject_user_id = 2;
  string model_id = 3;
  Modal modal = 4;
  repeated ChatMessage input = 5;
  string system_prompt = 6;
  repeated ToolSpec tools = 7;
  float temperature = 8;
  float top_p = 9;
  int32 max_tokens = 10;
  RoutePolicy route_policy = 11;
  FallbackPolicy fallback = 12;
  int32 timeout_ms = 13;
}

message GenerateResponse {
  google.protobuf.Struct output = 1;
  FinishReason finish_reason = 2;
  UsageStats usage = 3;
  RoutePolicy route_decision = 4;
  string model_resolved = 5;
  string trace_id = 6;
}

message StreamGenerateRequest {
  string app_id = 1;
  string subject_user_id = 2;
  string model_id = 3;
  Modal modal = 4;
  repeated ChatMessage input = 5;
  string system_prompt = 6;
  repeated ToolSpec tools = 7;
  float temperature = 8;
  float top_p = 9;
  int32 max_tokens = 10;
  RoutePolicy route_policy = 11;
  FallbackPolicy fallback = 12;
  int32 timeout_ms = 13;
}

message StreamStarted {
  string model_resolved = 1;
  RoutePolicy route_decision = 2;
}

message StreamDelta {
  string text = 1;
}

message ToolCallEvent {
  string tool_name = 1;
  google.protobuf.Struct tool_input = 2;
}

message ToolResultEvent {
  string tool_name = 1;
  google.protobuf.Struct tool_output = 2;
}

message StreamCompleted {
  FinishReason finish_reason = 1;
}

message StreamFailed {
  ReasonCode reason_code = 1;
  string action_hint = 2;
}

message StreamGenerateEvent {
  StreamEventType event_type = 1;
  uint64 sequence = 2;
  string trace_id = 3;
  google.protobuf.Timestamp timestamp = 4;
  oneof payload {
    StreamStarted started = 10;
    StreamDelta delta = 11;
    ToolCallEvent tool_call = 12;
    ToolResultEvent tool_result = 13;
    UsageStats usage = 14;
    StreamCompleted completed = 15;
    StreamFailed failed = 16;
  }
}

message EmbedRequest {
  string app_id = 1;
  string subject_user_id = 2;
  string model_id = 3;
  repeated string inputs = 4;
  RoutePolicy route_policy = 5;
  FallbackPolicy fallback = 6;
  int32 timeout_ms = 7;
}

message EmbedResponse {
  repeated google.protobuf.ListValue vectors = 1;
  UsageStats usage = 2;
  RoutePolicy route_decision = 3;
  string model_resolved = 4;
  string trace_id = 5;
}

message GenerateImageRequest {
  string app_id = 1;
  string subject_user_id = 2;
  string model_id = 3;
  string prompt = 4;
  RoutePolicy route_policy = 5;
  FallbackPolicy fallback = 6;
  int32 timeout_ms = 7;
}

message GenerateVideoRequest {
  string app_id = 1;
  string subject_user_id = 2;
  string model_id = 3;
  string prompt = 4;
  RoutePolicy route_policy = 5;
  FallbackPolicy fallback = 6;
  int32 timeout_ms = 7;
}

message SynthesizeSpeechRequest {
  string app_id = 1;
  string subject_user_id = 2;
  string model_id = 3;
  string text = 4;
  RoutePolicy route_policy = 5;
  FallbackPolicy fallback = 6;
  int32 timeout_ms = 7;
}

message ArtifactChunk {
  string artifact_id = 1;
  string mime_type = 2;
  uint64 sequence = 3;
  bytes chunk = 4;
  bool eof = 5;
  UsageStats usage = 6;
  RoutePolicy route_decision = 7;
  string model_resolved = 8;
  string trace_id = 9;
}

message TranscribeAudioRequest {
  string app_id = 1;
  string subject_user_id = 2;
  string model_id = 3;
  bytes audio_bytes = 4;
  string mime_type = 5;
  RoutePolicy route_policy = 6;
  FallbackPolicy fallback = 7;
  int32 timeout_ms = 8;
}

message TranscribeAudioResponse {
  string text = 1;
  UsageStats usage = 2;
  RoutePolicy route_decision = 3;
  string model_resolved = 4;
  string trace_id = 5;
}

service RuntimeAiService {
  rpc Generate(GenerateRequest) returns (GenerateResponse);
  rpc StreamGenerate(StreamGenerateRequest) returns (stream StreamGenerateEvent);
  rpc Embed(EmbedRequest) returns (EmbedResponse);
  rpc GenerateImage(GenerateImageRequest) returns (stream ArtifactChunk);
  rpc GenerateVideo(GenerateVideoRequest) returns (stream ArtifactChunk);
  rpc SynthesizeSpeech(SynthesizeSpeechRequest) returns (stream ArtifactChunk);
  rpc TranscribeAudio(TranscribeAudioRequest) returns (TranscribeAudioResponse);
}
```

> REF-ERRATA (2026-02-26): 上述 `ai.proto` 片段为 V1 baseline。面向多厂商多模态的 canonical media 字段、async job RPC、artifact metadata 扩展与 provider_options 口径，以 `ssot/runtime/multimodal-provider-contract.md` 为强约束真相。

## 5. workflow.proto（DAG 定稿）

```proto
syntax = "proto3";

package nimi.runtime.v1;

import "google/protobuf/struct.proto";
import "google/protobuf/timestamp.proto";
import "runtime/v1/ai.proto";
import "runtime/v1/common.proto";

enum WorkflowStatus {
  WORKFLOW_STATUS_UNSPECIFIED = 0;
  WORKFLOW_STATUS_ACCEPTED = 1;
  WORKFLOW_STATUS_QUEUED = 2;
  WORKFLOW_STATUS_RUNNING = 3;
  WORKFLOW_STATUS_COMPLETED = 4;
  WORKFLOW_STATUS_FAILED = 5;
  WORKFLOW_STATUS_CANCELED = 6;
  WORKFLOW_STATUS_SKIPPED = 7;
}

enum WorkflowEventType {
  WORKFLOW_EVENT_TYPE_UNSPECIFIED = 0;
  WORKFLOW_EVENT_STARTED = 1;
  WORKFLOW_EVENT_NODE_STARTED = 2;
  WORKFLOW_EVENT_NODE_PROGRESS = 3;
  WORKFLOW_EVENT_NODE_COMPLETED = 4;
  WORKFLOW_EVENT_NODE_SKIPPED = 5;
  WORKFLOW_EVENT_COMPLETED = 6;
  WORKFLOW_EVENT_FAILED = 7;
  WORKFLOW_EVENT_CANCELED = 8;
}

enum WorkflowNodeType {
  WORKFLOW_NODE_TYPE_UNSPECIFIED = 0;
  WORKFLOW_NODE_AI_GENERATE = 1;
  WORKFLOW_NODE_AI_STREAM = 2;
  WORKFLOW_NODE_AI_EMBED = 3;
  WORKFLOW_NODE_AI_IMAGE = 4;
  WORKFLOW_NODE_AI_VIDEO = 5;
  WORKFLOW_NODE_AI_TTS = 6;
  WORKFLOW_NODE_AI_STT = 7;
  WORKFLOW_NODE_TRANSFORM_EXTRACT = 20;
  WORKFLOW_NODE_TRANSFORM_TEMPLATE = 21;
  WORKFLOW_NODE_TRANSFORM_SCRIPT = 22;
  WORKFLOW_NODE_CONTROL_BRANCH = 40;
  WORKFLOW_NODE_CONTROL_MERGE = 41;
  WORKFLOW_NODE_CONTROL_NOOP = 42;
}

enum MergeStrategy {
  MERGE_STRATEGY_UNSPECIFIED = 0;
  MERGE_STRATEGY_ALL = 1;
  MERGE_STRATEGY_ANY = 2;
  MERGE_STRATEGY_N_OF_M = 3;
}

message WorkflowEdge {
  string from_node_id = 1;
  string from_output = 2;
  string to_node_id = 3;
  string to_input = 4;
}

message WorkflowNode {
  string node_id = 1;
  WorkflowNodeType node_type = 2;
  repeated string depends_on = 3;
  oneof type_config {
    AiGenerateNodeConfig ai_generate_config = 10;
    AiStreamNodeConfig ai_stream_config = 11;
    AiEmbedNodeConfig ai_embed_config = 12;
    AiImageNodeConfig ai_image_config = 13;
    AiVideoNodeConfig ai_video_config = 14;
    AiTtsNodeConfig ai_tts_config = 15;
    AiSttNodeConfig ai_stt_config = 16;
    ExtractNodeConfig extract_config = 20;
    TemplateNodeConfig template_config = 21;
    ScriptNodeConfig script_config = 22;
    BranchNodeConfig branch_config = 30;
    MergeNodeConfig merge_config = 31;
    NoopNodeConfig noop_config = 32;
  }
  int32 retry_max_attempts = 5;
  string retry_backoff = 6;
}

message WorkflowDefinition {
  string workflow_type = 1;
  repeated WorkflowNode nodes = 2;
  repeated WorkflowEdge edges = 3;
}

message SubmitWorkflowRequest {
  string app_id = 1;
  string subject_user_id = 2;
  WorkflowDefinition definition = 3;
  int32 timeout_ms = 4;
}

message SubmitWorkflowResponse {
  string task_id = 1;
  bool accepted = 2;
  ReasonCode reason_code = 3;
}

message GetWorkflowRequest {
  string task_id = 1;
}

message WorkflowNodeStatus {
  string node_id = 1;
  WorkflowStatus status = 2;
  int32 attempt = 3;
  string reason = 4;
}

message GetWorkflowResponse {
  string task_id = 1;
  WorkflowStatus status = 2;
  repeated WorkflowNodeStatus nodes = 3;
  google.protobuf.Struct output = 4;
  ReasonCode reason_code = 5;
}

message CancelWorkflowRequest {
  string task_id = 1;
}

message WorkflowEvent {
  WorkflowEventType event_type = 1;
  uint64 sequence = 2;
  string task_id = 3;
  string trace_id = 4;
  google.protobuf.Timestamp timestamp = 5;
  string node_id = 6;
  int32 progress_percent = 7;
  ReasonCode reason_code = 8;
  google.protobuf.Struct payload = 9;
}

message SubscribeWorkflowEventsRequest {
  string task_id = 1;
}

service RuntimeWorkflowService {
  rpc SubmitWorkflow(SubmitWorkflowRequest) returns (SubmitWorkflowResponse);
  rpc GetWorkflow(GetWorkflowRequest) returns (GetWorkflowResponse);
  rpc CancelWorkflow(CancelWorkflowRequest) returns (Ack);
  rpc SubscribeWorkflowEvents(SubscribeWorkflowEventsRequest) returns (stream WorkflowEvent);
}
```

## 5.1 script_worker.proto（内部 worker 协议）

```proto
syntax = "proto3";

package nimi.runtime.v1;

import "google/protobuf/struct.proto";

service ScriptWorkerService {
  rpc Execute(ExecuteRequest) returns (ExecuteResponse);
}

message ExecuteRequest {
  string task_id = 1;
  string node_id = 2;
  map<string, google.protobuf.Struct> inputs = 3;
  string runtime = 4;            // starlark | expr
  string code = 5;
  int32 timeout_ms = 6;
  int64 memory_limit_bytes = 7;
}

message ExecuteResponse {
  google.protobuf.Struct output = 1;
  bool success = 2;
  string error_message = 3;
}
```

## 6. model.proto（骨架）

```proto
syntax = "proto3";

package nimi.runtime.v1;

import "google/protobuf/timestamp.proto";
import "runtime/v1/common.proto";

enum ModelStatus {
  MODEL_STATUS_UNSPECIFIED = 0;
  MODEL_STATUS_INSTALLED = 1;
  MODEL_STATUS_PULLING = 2;
  MODEL_STATUS_FAILED = 3;
  MODEL_STATUS_REMOVED = 4;
}

message ModelDescriptor {
  string model_id = 1;
  string version = 2;
  ModelStatus status = 3;
  repeated string capabilities = 4;
  google.protobuf.Timestamp last_health_at = 5;
}

message ListModelsRequest {}
message ListModelsResponse {
  repeated ModelDescriptor models = 1;
}

message PullModelRequest {
  string app_id = 1;
  string model_ref = 2;
  string source = 3;
  string digest = 4;
}

message PullModelResponse {
  string task_id = 1;
  bool accepted = 2;
  ReasonCode reason_code = 3;
}

message RemoveModelRequest {
  string app_id = 1;
  string model_id = 2;
}

message CheckModelHealthRequest {
  string model_id = 1;
}

message CheckModelHealthResponse {
  bool healthy = 1;
  ReasonCode reason_code = 2;
  string action_hint = 3;
}

service RuntimeModelService {
  rpc ListModels(ListModelsRequest) returns (ListModelsResponse);
  rpc PullModel(PullModelRequest) returns (PullModelResponse);
  rpc RemoveModel(RemoveModelRequest) returns (Ack);
  rpc CheckModelHealth(CheckModelHealthRequest) returns (CheckModelHealthResponse);
}
```

## 7. grant.proto（骨架）

```proto
syntax = "proto3";

package nimi.runtime.v1;

import "google/protobuf/timestamp.proto";
import "runtime/v1/common.proto";

enum PolicyMode {
  POLICY_MODE_UNSPECIFIED = 0;
  POLICY_MODE_PRESET = 1;
  POLICY_MODE_CUSTOM = 2;
}

enum AuthorizationPreset {
  AUTHORIZATION_PRESET_UNSPECIFIED = 0;
  AUTHORIZATION_PRESET_READ_ONLY = 1;
  AUTHORIZATION_PRESET_FULL = 2;
  AUTHORIZATION_PRESET_DELEGATE = 3;
}

message AuthorizeExternalPrincipalRequest {
  string domain = 1;
  string app_id = 2;
  string external_principal_id = 3;
  ExternalPrincipalType external_principal_type = 4;
  string subject_user_id = 5;
  string consent_id = 6;
  string consent_version = 7;
  google.protobuf.Timestamp decision_at = 8;
  string policy_version = 9;
  PolicyMode policy_mode = 10;
  AuthorizationPreset preset = 11;
  repeated string scopes = 12;
  ResourceSelectors resource_selectors = 13;
  bool can_delegate = 14;
  int32 max_delegation_depth = 15;
  int32 ttl_seconds = 16;
  string scope_catalog_version = 17;
  bool policy_override = 18;
}

message AuthorizeExternalPrincipalResponse {
  string token_id = 1;
  string app_id = 2;
  string subject_user_id = 3;
  string external_principal_id = 4;
  repeated string effective_scopes = 5;
  ResourceSelectors resource_selectors = 6;
  ConsentRef consent_ref = 7;
  string policy_version = 8;
  string issued_scope_catalog_version = 9;
  bool can_delegate = 10;
  google.protobuf.Timestamp expires_at = 11;
  string secret = 12;
}

message ValidateAppAccessTokenRequest {
  string app_id = 1;
  string token_id = 2;
  string subject_user_id = 3;
  string operation = 4;
  repeated string requested_scopes = 5;
  ResourceSelectors resource_selectors = 6;
}

message ValidateAppAccessTokenResponse {
  bool valid = 1;
  ReasonCode reason_code = 2;
  repeated string effective_scopes = 3;
  string policy_version = 4;
  string issued_scope_catalog_version = 5;
  string action_hint = 6;
}

message RevokeAppAccessTokenRequest {
  string app_id = 1;
  string token_id = 2;
}

message IssueDelegatedAccessTokenRequest {
  string app_id = 1;
  string parent_token_id = 2;
  repeated string scopes = 3;
  ResourceSelectors resource_selectors = 4;
  int32 ttl_seconds = 5;
}

message IssueDelegatedAccessTokenResponse {
  string token_id = 1;
  string parent_token_id = 2;
  repeated string effective_scopes = 3;
  google.protobuf.Timestamp expires_at = 4;
  string secret = 5;
}

message ListTokenChainRequest {
  string app_id = 1;
  string root_token_id = 2;
}

message TokenChainNode {
  string token_id = 1;
  string parent_token_id = 2;
  string external_principal_id = 3;
  string policy_version = 4;
  string issued_scope_catalog_version = 5;
  google.protobuf.Timestamp issued_at = 6;
  google.protobuf.Timestamp expires_at = 7;
}

message ListTokenChainResponse {
  repeated TokenChainNode nodes = 1;
}

service RuntimeGrantService {
  rpc AuthorizeExternalPrincipal(AuthorizeExternalPrincipalRequest) returns (AuthorizeExternalPrincipalResponse);
  rpc ValidateAppAccessToken(ValidateAppAccessTokenRequest) returns (ValidateAppAccessTokenResponse);
  rpc RevokeAppAccessToken(RevokeAppAccessTokenRequest) returns (Ack);
  rpc IssueDelegatedAccessToken(IssueDelegatedAccessTokenRequest) returns (IssueDelegatedAccessTokenResponse);
  rpc ListTokenChain(ListTokenChainRequest) returns (ListTokenChainResponse);
}
```

## 8. auth.proto（骨架）

```proto
syntax = "proto3";

package nimi.runtime.v1;

import "google/protobuf/timestamp.proto";
import "runtime/v1/common.proto";

enum ExternalProofType {
  EXTERNAL_PROOF_TYPE_UNSPECIFIED = 0;
  EXTERNAL_PROOF_TYPE_ED25519 = 1;
  EXTERNAL_PROOF_TYPE_HMAC_SHA256 = 2;
}

enum AppMode {
  APP_MODE_UNSPECIFIED = 0;
  APP_MODE_LITE = 1;
  APP_MODE_CORE_ONLY = 2;
  APP_MODE_FULL = 3;
}

enum WorldRelation {
  WORLD_RELATION_UNSPECIFIED = 0;
  WORLD_RELATION_NONE = 1;
  WORLD_RELATION_RENDER = 2;
  WORLD_RELATION_EXTENSION = 3;
}

message AppModeManifest {
  AppMode app_mode = 1;
  bool runtime_required = 2;
  bool realm_required = 3;
  WorldRelation world_relation = 4;
}

message RegisterAppRequest {
  string app_id = 1;
  string app_instance_id = 2;
  string device_id = 3;
  string app_version = 4;
  repeated string capabilities = 5;
  AppModeManifest mode_manifest = 6;
}

message RegisterAppResponse {
  string app_instance_id = 1;
  bool accepted = 2;
  ReasonCode reason_code = 3;
}

message OpenSessionRequest {
  string app_id = 1;
  string app_instance_id = 2;
  string device_id = 3;
  string subject_user_id = 4;
  int32 ttl_seconds = 5;
}

message OpenSessionResponse {
  string session_id = 1;
  google.protobuf.Timestamp issued_at = 2;
  google.protobuf.Timestamp expires_at = 3;
  string session_token = 4;
  ReasonCode reason_code = 5;
}

message RefreshSessionRequest {
  string session_id = 1;
  int32 ttl_seconds = 2;
}

message RefreshSessionResponse {
  string session_id = 1;
  google.protobuf.Timestamp expires_at = 2;
  string session_token = 3;
  ReasonCode reason_code = 4;
}

message RevokeSessionRequest {
  string session_id = 1;
}

message RegisterExternalPrincipalRequest {
  string app_id = 1;
  string external_principal_id = 2;
  ExternalPrincipalType external_principal_type = 3;
  string issuer = 4;
  string client_id = 5;
  string signature_key_id = 6;
  ExternalProofType proof_type = 7;
}

message RegisterExternalPrincipalResponse {
  bool accepted = 1;
  ReasonCode reason_code = 2;
}

message OpenExternalPrincipalSessionRequest {
  string app_id = 1;
  string external_principal_id = 2;
  string proof = 3;
  int32 ttl_seconds = 4;
}

message OpenExternalPrincipalSessionResponse {
  string external_session_id = 1;
  google.protobuf.Timestamp expires_at = 2;
  string session_token = 3;
  ReasonCode reason_code = 4;
}

message RevokeExternalPrincipalSessionRequest {
  string external_session_id = 1;
}

service RuntimeAuthService {
  rpc RegisterApp(RegisterAppRequest) returns (RegisterAppResponse);
  rpc OpenSession(OpenSessionRequest) returns (OpenSessionResponse);
  rpc RefreshSession(RefreshSessionRequest) returns (RefreshSessionResponse);
  rpc RevokeSession(RevokeSessionRequest) returns (Ack);
  rpc RegisterExternalPrincipal(RegisterExternalPrincipalRequest) returns (RegisterExternalPrincipalResponse);
  rpc OpenExternalPrincipalSession(OpenExternalPrincipalSessionRequest) returns (OpenExternalPrincipalSessionResponse);
  rpc RevokeExternalPrincipalSession(RevokeExternalPrincipalSessionRequest) returns (Ack);
}
```

## 9. knowledge.proto（骨架）

```proto
syntax = "proto3";

package nimi.runtime.v1;

import "google/protobuf/struct.proto";
import "runtime/v1/common.proto";

message BuildIndexRequest {
  string app_id = 1;
  string subject_user_id = 2;
  string index_id = 3;
  string source_kind = 4;
  repeated string source_uris = 5;
  string embedding_model_id = 6;
  bool overwrite = 7;
  google.protobuf.Struct options = 8;
}

message BuildIndexResponse {
  string task_id = 1;
  bool accepted = 2;
  ReasonCode reason_code = 3;
}

message SearchIndexRequest {
  string app_id = 1;
  string subject_user_id = 2;
  string index_id = 3;
  string query = 4;
  int32 top_k = 5;
  google.protobuf.Struct filters = 6;
}

message SearchHit {
  string document_id = 1;
  float score = 2;
  string snippet = 3;
  google.protobuf.Struct metadata = 4;
}

message SearchIndexResponse {
  repeated SearchHit hits = 1;
  ReasonCode reason_code = 2;
}

message DeleteIndexRequest {
  string app_id = 1;
  string subject_user_id = 2;
  string index_id = 3;
}

service RuntimeKnowledgeService {
  rpc BuildIndex(BuildIndexRequest) returns (BuildIndexResponse);
  rpc SearchIndex(SearchIndexRequest) returns (SearchIndexResponse);
  rpc DeleteIndex(DeleteIndexRequest) returns (Ack);
}
```

## 10. app.proto（骨架）

```proto
syntax = "proto3";

package nimi.runtime.v1;

import "google/protobuf/struct.proto";
import "google/protobuf/timestamp.proto";
import "runtime/v1/common.proto";

enum AppMessageEventType {
  APP_MESSAGE_EVENT_TYPE_UNSPECIFIED = 0;
  APP_MESSAGE_EVENT_RECEIVED = 1;
  APP_MESSAGE_EVENT_ACKED = 2;
  APP_MESSAGE_EVENT_FAILED = 3;
}

message SendAppMessageRequest {
  string from_app_id = 1;
  string to_app_id = 2;
  string subject_user_id = 3;
  string message_type = 4;
  google.protobuf.Struct payload = 5;
  bool require_ack = 6;
}

message SendAppMessageResponse {
  string message_id = 1;
  bool accepted = 2;
  ReasonCode reason_code = 3;
}

message SubscribeAppMessagesRequest {
  string app_id = 1;
  string subject_user_id = 2;
  string cursor = 3;
  repeated string from_app_ids = 4;
}

message AppMessageEvent {
  AppMessageEventType event_type = 1;
  uint64 sequence = 2;
  string message_id = 3;
  string from_app_id = 4;
  string to_app_id = 5;
  string subject_user_id = 6;
  string message_type = 7;
  google.protobuf.Struct payload = 8;
  ReasonCode reason_code = 9;
  string trace_id = 10;
  google.protobuf.Timestamp timestamp = 11;
}

service RuntimeAppService {
  rpc SendAppMessage(SendAppMessageRequest) returns (SendAppMessageResponse);
  rpc SubscribeAppMessages(SubscribeAppMessagesRequest) returns (stream AppMessageEvent);
}
```

## 11. audit.proto（骨架）

```proto
syntax = "proto3";

package nimi.runtime.v1;

import "google/protobuf/struct.proto";
import "google/protobuf/timestamp.proto";
import "runtime/v1/common.proto";

message ListAuditEventsRequest {
  string app_id = 1;
  string subject_user_id = 2;
  string domain = 3;
  ReasonCode reason_code = 4;
  google.protobuf.Timestamp from_time = 5;
  google.protobuf.Timestamp to_time = 6;
  int32 page_size = 7;
  string page_token = 8;
  CallerKind caller_kind = 9;
  string caller_id = 10;
}

message AuditEventRecord {
  string audit_id = 1;
  string app_id = 2;
  string subject_user_id = 3;
  string domain = 4;
  string operation = 5;
  ReasonCode reason_code = 6;
  string trace_id = 7;
  google.protobuf.Timestamp timestamp = 8;
  google.protobuf.Struct payload = 9;
  CallerKind caller_kind = 10;
  string caller_id = 11;
  string surface_id = 12;
  string principal_id = 13;
  string principal_type = 14;
  string external_principal_type = 15;
  string capability = 16;
  string token_id = 17;
  string parent_token_id = 18;
  string consent_id = 19;
  string consent_version = 20;
  string policy_version = 21;
  string resource_selector_hash = 22;
  string scope_catalog_version = 23;
}

message ListAuditEventsResponse {
  repeated AuditEventRecord events = 1;
  string next_page_token = 2;
}

message ExportAuditEventsRequest {
  string app_id = 1;
  string subject_user_id = 2;
  string format = 3;
  google.protobuf.Timestamp from_time = 4;
  google.protobuf.Timestamp to_time = 5;
  bool compress = 6;
}

enum UsageWindow {
  USAGE_WINDOW_UNSPECIFIED = 0;
  USAGE_WINDOW_MINUTE = 1;
  USAGE_WINDOW_HOUR = 2;
  USAGE_WINDOW_DAY = 3;
}

enum RuntimeHealthStatus {
  RUNTIME_HEALTH_STATUS_UNSPECIFIED = 0;
  RUNTIME_HEALTH_STATUS_STOPPED = 1;
  RUNTIME_HEALTH_STATUS_STARTING = 2;
  RUNTIME_HEALTH_STATUS_READY = 3;
  RUNTIME_HEALTH_STATUS_DEGRADED = 4;
  RUNTIME_HEALTH_STATUS_STOPPING = 5;
}

message ListUsageStatsRequest {
  string app_id = 1;
  string subject_user_id = 2;
  CallerKind caller_kind = 3;
  string caller_id = 4;
  string capability = 5;
  string model_id = 6;
  UsageWindow window = 7;
  google.protobuf.Timestamp from_time = 8;
  google.protobuf.Timestamp to_time = 9;
  int32 page_size = 10;
  string page_token = 11;
}

message UsageStatRecord {
  string app_id = 1;
  string subject_user_id = 2;
  CallerKind caller_kind = 3;
  string caller_id = 4;
  string capability = 5;
  string model_id = 6;
  UsageWindow window = 7;
  google.protobuf.Timestamp bucket_start = 8;
  int64 request_count = 9;
  int64 success_count = 10;
  int64 error_count = 11;
  int64 input_tokens = 12;
  int64 output_tokens = 13;
  int64 compute_ms = 14;
  int64 queue_wait_ms = 15;
}

message ListUsageStatsResponse {
  repeated UsageStatRecord records = 1;
  string next_page_token = 2;
}

message GetRuntimeHealthRequest {}

message GetRuntimeHealthResponse {
  RuntimeHealthStatus status = 1;
  string reason = 2;
  int32 queue_depth = 3;
  int32 active_workflows = 4;
  int32 active_inference_jobs = 5;
  int64 cpu_milli = 6;
  int64 memory_bytes = 7;
  int64 vram_bytes = 8;
  google.protobuf.Timestamp sampled_at = 9;
}

message SubscribeRuntimeHealthEventsRequest {}

message RuntimeHealthEvent {
  uint64 sequence = 1;
  RuntimeHealthStatus status = 2;
  string reason = 3;
  int32 queue_depth = 4;
  int32 active_workflows = 5;
  int32 active_inference_jobs = 6;
  int64 cpu_milli = 7;
  int64 memory_bytes = 8;
  int64 vram_bytes = 9;
  google.protobuf.Timestamp sampled_at = 10;
}

message AuditExportChunk {
  string export_id = 1;
  uint64 sequence = 2;
  bytes chunk = 3;
  bool eof = 4;
  string mime_type = 5;
}

service RuntimeAuditService {
  rpc ListAuditEvents(ListAuditEventsRequest) returns (ListAuditEventsResponse);
  rpc ExportAuditEvents(ExportAuditEventsRequest) returns (stream AuditExportChunk);
  rpc ListUsageStats(ListUsageStatsRequest) returns (ListUsageStatsResponse);
  rpc GetRuntimeHealth(GetRuntimeHealthRequest) returns (GetRuntimeHealthResponse);
  rpc SubscribeRuntimeHealthEvents(SubscribeRuntimeHealthEventsRequest) returns (stream RuntimeHealthEvent);
}
```

## 12. 编码约束（必填）

1. `MUST`：`RuntimeAiService.StreamGenerate` 事件顺序遵循 `started -> ... -> completed|failed`。
2. `MUST`：`RuntimeWorkflowService` 以 `task_id` 为唯一任务跟踪键，不复用 AI 调用返回结构。
3. `MUST`：`AuthorizeExternalPrincipal` 语义保持单事务（策略创建 + token 签发）。
4. `MUST`：策略更新后，旧 `policy_version` token 校验必须拒绝。
5. `MUST`：scope 校验使用 `issued_scope_catalog_version + 当前撤销索引`。
6. `MUST`：V1 大 payload 仅允许 gRPC streaming/分块，不启用 shared memory。
7. `MUST`：`RevokeSession` 与 `RevokeExternalPrincipalSession` 必须幂等。
8. `MUST`：`SubscribeAppMessages` 事件必须按 `sequence` 单调递增输出。
9. `MUST`：`ExportAuditEvents` 必须使用流式分块返回，不允许一次性大包导出。
10. `MUST`：`ListUsageStats` 与审计事件必须使用相同 `callerKind + callerId` 归因口径。
11. `MUST`：`GetRuntimeHealth/SubscribeRuntimeHealthEvents` 状态必须可直接驱动 desktop Runtime Console。
12. `MUST`：按 App mode 先做域级校验再做 scope 校验；模式违规分别返回 `APP_MODE_DOMAIN_FORBIDDEN` / `APP_MODE_SCOPE_FORBIDDEN`。

## 13. 待定项

- 当前无待定项（新增待定需先写入 `INDEX.md` 决策记录）。
