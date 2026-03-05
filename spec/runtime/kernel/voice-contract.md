# Voice Contract

> Owner Domain: `K-VOICE-*`

## K-VOICE-001 Scope

Voice 是 Runtime 一等能力，负责两类语音设计工作流与 voice 资产生命周期：

- `tts_v2v`（voice/audio -> voice）
- `tts_t2v`（text -> voice）

Voice 能力必须独立于 `SubmitMediaJob` 的 provider 私有参数语义。

## K-VOICE-002 Workflow Type Registry

Voice 工作流类型以 `tables/voice-workflow-types.yaml` 为唯一事实源。

## K-VOICE-003 VoiceReference Contract

语音合成入口必须通过 `VoiceReference` 表达，且仅允许三种引用来源：

- `preset_voice_id`
- `voice_asset_id`
- `provider_voice_ref`

引用类型以 `tables/voice-reference-kinds.yaml` 为事实源。

## K-VOICE-004 VoiceAsset Contract

`VoiceAsset` 为可持久化资源，最小必填字段：

- `voice_asset_id`
- `app_id`
- `subject_user_id`
- `workflow_type`
- `provider`
- `model_id`
- `target_model_id`
- `provider_voice_ref`
- `persistence`
- `status`

`persistence` 取值以 `tables/voice-persistence-types.yaml` 为事实源。
`status` 取值以 `tables/voice-asset-statuses.yaml` 为事实源。

## K-VOICE-005 VoiceJob Lifecycle

Voice 创建必须使用异步 `VoiceJob` 语义。状态机固定为：

- `SUBMITTED`
- `QUEUED`
- `RUNNING`
- `COMPLETED`
- `FAILED`
- `CANCELED`
- `TIMEOUT`

事件流 `SubscribeVoiceJobEvents` 的事件状态必须与 Job 状态对齐。

## K-VOICE-006 Tenant Isolation

VoiceAsset 默认 user-scoped。跨 `app_id` 或跨 `subject_user_id` 访问必须 fail-close，禁止跨租户泄露。

## K-VOICE-007 Target Model Binding

VoiceAsset 在创建时必须绑定 `target_model_id`。

`tts_synthesize` 阶段若请求模型与已绑定 `target_model_id` 不一致，必须返回 `AI_VOICE_TARGET_MODEL_MISMATCH`。

## K-VOICE-008 RuntimeVoiceService Surface

`RuntimeVoiceService` 方法集合固定为：

1. `SubmitVoiceJob`
2. `GetVoiceJob`
3. `CancelVoiceJob`
4. `SubscribeVoiceJobEvents`
5. `GetVoiceAsset`
6. `ListVoiceAssets`
7. `DeleteVoiceAsset`
8. `ListPresetVoices`

## K-VOICE-009 Dual Discovery Channel

Voice 发现必须分离两条通道：

- 系统预置音色：`ListPresetVoices`
- 用户自定义音色：`ListVoiceAssets`

调用方不得依赖单一接口混合系统音色与用户音色。

## K-VOICE-010 Fail-Close Error Model

Voice 相关输入、工作流、资产状态、权限与作业状态错误必须映射到 `AI_VOICE_*` ReasonCode 族，并遵循 fail-close。

## K-VOICE-011 Provider Native Multi-Step Workflow Encapsulation

provider 原生两段式创建流程（例如 `preview -> create`）必须封装在单一 `VoiceJob` 生命周期中对外暴露。

调用方只感知统一状态机与统一结果：

- 输入：`SubmitVoiceJob`
- 事件：`SubscribeVoiceJobEvents`
- 输出：`VoiceAsset` + `VoiceReference`

不得将 provider 内部步骤泄露为额外公共 RPC。

## K-VOICE-012 Preset Voice Metadata Compatibility

`ListPresetVoices` 结果应支持跨 provider 的可选元数据扩展（如标签、分类、试听地址）。  
缺失元数据时必须保持字段可省略，不得因 provider 无该字段而拒绝返回预置音色列表。

## K-VOICE-013 Discovery Mode Responsibility Boundary

Catalog `voice.discovery_mode` 与发现接口职责必须严格对应：

- `static_catalog|dynamic_global`：预置音色发现由 `ListPresetVoices` 承担。
- `dynamic_user_scoped`：用户资产发现由 `ListVoiceAssets` 承担。

provider 同时支持全局预置与用户资产时，允许同时暴露两条通道，但不得混流返回。
