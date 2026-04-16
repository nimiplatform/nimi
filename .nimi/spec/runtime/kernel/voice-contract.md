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

`VoiceReference` may be embedded by runtime-owned `AgentPresentationProfile` as a default voice binding. That reuse does not transfer voice workflow, discovery, or asset ownership out of `K-VOICE-*`.

## K-VOICE-004 VoiceAsset Contract

`VoiceAsset` 是 runtime-managed voice resource object，最小必填字段：

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

`VoiceAsset` 的 `persistence` 只表达逻辑生命周期与 handle policy，不自动承诺 runtime 已拥有 durable local substrate。
在 durable local substrate 被单独 admitted 前，local-generated `VoiceAsset` 允许保持 session-local orchestration object 语义。

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

## K-VOICE-014 Runtime-Owned Asset Truth vs Provider-Owned Handle Truth

`VoiceAsset` 与 `provider_voice_ref` 必须严格分离：

- `VoiceAsset`：runtime-owned object truth
- `provider_voice_ref`：provider-owned native handle truth

二者不得互相替代：

- runtime 不得把 `provider_voice_ref` 升格成公共主键或公共资产真相
- provider 也不得绕过 `VoiceAsset` 直接成为 runtime 用户资产主对象

当 provider 返回 native custom voice handle 时，runtime 必须将其收敛到 `VoiceAsset + VoiceReference` 公共契约中对外暴露。

## K-VOICE-015 Voice Handle Policy Minimum Contract

workflow-capable voice family 一旦 admitted，必须显式声明 `voice_handle_policy`。

`voice_handle_policy` 最小字段固定为：

- `persistence`
- `scope`
- `default_ttl`
- `delete_semantics`
- `runtime_reconciliation_required`

其中：

- `persistence` 继续取值于 `tables/voice-enums.yaml` `persistence_types`
- `scope` 取值于 `tables/voice-enums.yaml` `handle_scopes`
- `delete_semantics` 取值于 `tables/voice-enums.yaml` `delete_semantics`

未声明 `voice_handle_policy` 的 workflow-capable family 不得被 admitted。

## K-VOICE-016 Family-Level Workflow Validation Boundary

workflow-capable speech family 的验收必须保持 family-level 边界，不得把不同 family 的 truth 混为一次“模型全绿”：

- workflow-capable local speech family（例如当前 first-wave 规划线的
  `qwen3_tts`，或后续可能 admitted 的其它 family）可用于验证：
  - `audio.synthesize`
  - `voice_workflow.tts_t2v`
  - `voice_workflow.tts_v2v`
- 但它们不得被当作 `audio.transcribe` 的替代验收对象

`audio.transcribe` 必须继续通过独立 STT family 的 admitted truth 验证，禁止以 workflow-capable TTS family 的成功结果隐式覆盖 STT readiness。

## K-VOICE-017 First Admitted Local Workflow Family Boundary

当 local workflow execution plane 进入第一轮 admitted wave 时，必须保持 family-scoped admission，而不是 generic local workflow green-light。

当前 first admitted local workflow family 边界固定为：

- `workflow_family = qwen3_tts`
- first-wave local admitted synth / workflow line 固定收敛到同一
  `Qwen3-TTS` family，而不是 generic `local speech`
- admitted local checkpoint mapping 固定为：
  - plain synth default lane:
    - `Qwen3-TTS-12Hz-0.6B-CustomVoice`
  - clone workflow default lane:
    - `Qwen3-TTS-12Hz-0.6B-Base`
  - design workflow default lane:
    - `Qwen3-TTS-12Hz-1.7B-VoiceDesign`
- admitted workflow types 仅限：
  - `tts_v2v`
  - `tts_t2v`

边界要求：

- `qwen3_tts` 的 admitted success 不得被解释为 generic `local` workflow success
- 其它 local workflow family（包括历史讨论过的 `voxcpm`、`omnivoice`）不在首轮 admitted 范围内，必须继续 fail-close，直到后续独立 admission
- local generated workflow handle 在首轮 admitted wave 中继续保持：
  - `persistence = session_ephemeral`
  - `delete_semantics = runtime_authoritative_delete`
  - `runtime_reconciliation_required = false`
- 首轮 admitted wave 不承诺 durable local `VoiceAsset` substrate，不得把 local generated handle 升格为跨重启 durable truth
- `audio.transcribe` 继续由独立 `STT` family 负责；当前 first-wave default `STT`
  family 固定为 `Qwen3-ASR`，不得由 `qwen3_tts` workflow success 隐式覆盖
