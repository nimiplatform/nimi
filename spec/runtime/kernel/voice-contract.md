# Voice Contract

> Owner Domain: `K-VOICE-*`

## K-VOICE-001 Scope

Voice 是 Runtime 一等能力，负责 Voice 创建场景与 voice 资产生命周期：

- `tts_v2v`（voice/audio -> voice）
- `tts_t2v`（text -> voice）

Voice 创建必须通过 Scenario 抽象统一执行：

- `SubmitScenarioJob` + `scenario_type=VOICE_CLONE`
- `SubmitScenarioJob` + `scenario_type=VOICE_DESIGN`

provider 私有参数不得自由透传；必须走 namespaced `ScenarioExtension` 并受 extension registry 约束。

## K-VOICE-002 Workflow Type Registry

Voice 工作流类型以 `tables/voice-enums.yaml` `workflow_types` 为唯一事实源。

## K-VOICE-003 VoiceReference Contract

语音合成入口必须通过 `VoiceReference` 表达，且仅允许三种引用来源：

- `preset_voice_id`
- `voice_asset_id`
- `provider_voice_ref`

引用类型以 `tables/voice-enums.yaml` `reference_kinds` 为事实源。

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

`persistence` 取值以 `tables/voice-enums.yaml` `persistence_types` 为事实源。
`status` 取值以 `tables/voice-enums.yaml` `asset_statuses` 为事实源。

## K-VOICE-005 Voice ScenarioJob Lifecycle

Voice 创建必须使用异步 `ScenarioJob` 语义。状态机与事件流对齐规则以 `K-JOB-002` 为唯一事实源；Voice 不在本合同重复定义一份并行 job 状态表。

## K-VOICE-006 Tenant Isolation

VoiceAsset 默认 user-scoped。跨 `app_id` 或跨 `subject_user_id` 访问必须 fail-close，禁止跨租户泄露。

## K-VOICE-007 Target Model Binding

VoiceAsset 在创建时必须绑定 `target_model_id`。

`tts_synthesize` 阶段若请求模型与已绑定 `target_model_id` 不一致，必须返回 `AI_VOICE_TARGET_MODEL_MISMATCH`。

## K-VOICE-008 AIService Voice Surface

Voice 对外 RPC 面已收归 `AIService`（proto `RuntimeAiService`），方法集合固定为：

1. `SubmitScenarioJob`（`VOICE_CLONE` / `VOICE_DESIGN`）
2. `GetScenarioJob`
3. `CancelScenarioJob`
4. `SubscribeScenarioJobEvents`
5. `GetVoiceAsset`
6. `ListVoiceAssets`
7. `DeleteVoiceAsset`
8. `ListPresetVoices`

`RuntimeVoiceService` 不是公共契约面，不得在 spec 中定义为独立服务。

## K-VOICE-009 Dual Discovery Channel

Voice 发现必须分离两条通道：

- 系统预置音色：`ListPresetVoices`
- 用户自定义音色：`ListVoiceAssets`

调用方不得依赖单一接口混合系统音色与用户音色。

## K-VOICE-010 Fail-Close Error Model

Voice 相关输入、工作流、资产状态、权限与作业状态错误必须映射到 `AI_VOICE_*` ReasonCode 族，并遵循 fail-close。

## K-VOICE-011 Provider Native Multi-Step Workflow Encapsulation

provider 原生两段式创建流程（例如 `preview -> create`）必须封装在单一 `ScenarioJob` 生命周期中对外暴露。

调用方只感知统一状态机与统一结果：

- 输入：`SubmitScenarioJob`（`scenario_type=VOICE_CLONE|VOICE_DESIGN`）
- 事件：`SubscribeScenarioJobEvents`
- 输出：`VoiceAsset` + `VoiceReference`

不得将 provider 内部步骤泄露为额外公共 RPC。

## K-VOICE-012 Preset Voice Metadata Compatibility

`ListPresetVoices` 结果应支持跨 provider 的可选元数据扩展（如标签、分类、试听地址）。  
缺失元数据时必须保持字段可省略，不得因 provider 无该字段而拒绝返回预置音色列表。

## K-VOICE-013 Discovery Mode Responsibility Boundary

Catalog `voice.discovery_mode` 与发现接口职责必须严格对应：

- `static_catalog`：预置音色发现由 `ListPresetVoices` 承担，返回值来自 YAML catalog snapshot 或显式本地 custom YAML。
- `dynamic_user_scoped`：用户资产发现由 `ListVoiceAssets` 承担。
- `mixed`：provider 同时暴露预置音色与用户资产，两条发现通道都必须可用，但仍由调用方分别调用 `ListPresetVoices` 与 `ListVoiceAssets`。

provider 同时支持全局预置与用户资产时，允许同时暴露两条通道，但不得混流返回。
