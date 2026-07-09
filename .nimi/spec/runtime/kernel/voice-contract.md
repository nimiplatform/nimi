# Voice Contract

> Owner Domain: `K-VOICE-*`

## K-VOICE-000 Runtime Target Identity v2 Hard Cut

Voice execution consumes v2 target refs or resolved binding inputs. Raw
`model_id` and `target_model_id` may remain only as post-resolve provider or
voice asset compatibility facts and must not mint durable target refs.

## K-VOICE-001 Scope

Voice 是 Runtime 一等能力，负责 Voice 创建场景与 voice 资产生命周期：

- `voice_clone`（voice/audio -> voice）
- `voice_design`（text -> voice）

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

公共绑定面（ordinary profile binding / SDK input / app-facing surface）只允许
`preset_voice_id` 或 `voice_asset_id`。`provider_voice_ref` 仅限 Runtime 内部、
明确 privileged、或 debug 面消费，不得作为 ordinary assistant 语音的公共绑定输入。
ordinary profile/SDK input 若收到裸 `provider_voice_ref` 或未显式判别的自由字符串
音色引用，必须 fail-close，不得静默升格为公共 provider handle 绑定。此限制与
`K-VOICE-014`（runtime-owned asset truth vs provider-owned handle truth）同源。

`VoiceReference` may be embedded by runtime-owned `AgentPresentationProfile` as a default voice binding. That reuse does not transfer voice workflow, discovery, or asset ownership out of `K-VOICE-*`.

## K-VOICE-004 VoiceAsset Contract

`VoiceAsset` 是 runtime-managed voice resource object，最小必填字段：

- `voice_asset_id`
- `app_id`
- `subject_user_id`
- `workflow_type`
- `provider`
- `target_ref`
- `voice_asset_target_ref`
- `provider_voice_ref`
- `persistence`
- `status`

`persistence` 取值以 `tables/voice-enums.yaml` `persistence_types` 为事实源。
`status` 取值以 `tables/voice-enums.yaml` `asset_statuses` 为事实源。

`target_ref` 与 `voice_asset_target_ref` 是 durable v2 target identity，取 `K-RTARGET-002`
/ `K-RTARGET-008` grammar。`VoiceAsset` 的 durable identity 由 `voice_asset_id` +
`voice_asset_target_ref` 承担，不得由 `model_id` / `target_model_id` 充当。若
`model_id` / `target_model_id` 出现，只能是 post-resolve provider / catalog / audit /
voice asset compatibility 的 `allowed_non_identity_fact`，并必须受守卫，不得 mint 或
persist durable target ref（见 `K-VOICE-000`）。

`VoiceAsset` 的 `persistence` 只表达逻辑生命周期与 handle policy，不自动承诺 runtime 已拥有 durable local substrate。
在 durable local substrate 被单独 admitted 前，local-generated `VoiceAsset` 允许保持 session-local orchestration object 语义。

Durability boundary（profile binding 前置条件）：

- 被 assistant profile 通过 `VoiceReference(voice_asset_id)` 绑定的 `VoiceAsset`
  必须具备 durable persistence class，且必须能在其创建来源 voice-workflow
  `ScenarioJob` 的终态 retention 被 prune 后继续存活（`VoiceAsset` 生命周期与
  voice workflow job retention 解耦）。
- 未 admitted durable local substrate 前，`persistence = session_ephemeral` 的
  local-generated `VoiceAsset` 不是 profile-bindable durable identity；把它作为
  ordinary assistant profile 的持久绑定必须 fail-close，而不是伪装成 durable。
- 具体 persistence class 的 cross-restart 行为、delete 语义与 provider handle
  cleanup 由 `K-VOICE-015` `voice_handle_policy` 与 `K-RPC-022` `DeleteVoiceAsset`
  边界共同约束。

## K-VOICE-005 Voice ScenarioJob Lifecycle

Voice 创建必须使用异步 `ScenarioJob` 语义。状态机与事件流对齐规则以 `K-JOB-002` 为唯一事实源；Voice 不在本合同重复定义一份并行 job 状态表。

## K-VOICE-006 Tenant Isolation

VoiceAsset 默认 user-scoped。跨 `app_id` 或跨 `subject_user_id` 访问必须 fail-close，禁止跨租户泄露。

## K-VOICE-007 Target Model Binding

VoiceAsset 在创建时必须绑定 `voice_asset_target_ref`。

`tts_synthesize` 阶段若请求 target ref 与已绑定 `voice_asset_target_ref` 不一致，必须返回 `AI_VOICE_TARGET_MODEL_MISMATCH`。

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

- workflow-capable local speech family（例如当前 baseline 规划线的
  `qwen3_tts`，或后续可能 admitted 的其它 family）可用于验证：
  - `audio.synthesize`
  - `voice_workflow.voice_design`
  - `voice_workflow.voice_clone`
- 但它们不得被当作 `audio.transcribe` 的替代验收对象

`audio.transcribe` 必须继续通过独立 STT family 的 admitted truth 验证，禁止以 workflow-capable TTS family 的成功结果隐式覆盖 STT readiness。

## K-VOICE-017 First Admitted Local Workflow Family Boundary

当 local workflow execution plane 首次进入 admitted 状态时，必须保持 family-scoped admission，而不是 generic local workflow green-light。

当前 first admitted local workflow family 边界固定为：

- `workflow_family = qwen3_tts`
- baseline local admitted synth / workflow line 固定收敛到同一
  `Qwen3-TTS` family，而不是 generic `local speech`
- admitted local checkpoint mapping 固定为：
  - plain synth default lane:
    - `Qwen3-TTS-12Hz-0.6B-CustomVoice`
  - clone workflow default lane:
    - `Qwen3-TTS-12Hz-0.6B-Base`
  - design workflow default lane:
    - `Qwen3-TTS-12Hz-1.7B-VoiceDesign`
- admitted workflow types 仅限：
  - `voice_clone`
  - `voice_design`

边界要求：

- `qwen3_tts` 的 admitted success 不得被解释为 generic `local` workflow success
- 其它 local workflow family（包括历史讨论过的 `voxcpm`、`omnivoice`）不在 baseline admitted 范围内，必须继续 fail-close，直到后续独立 admission
- local generated workflow handle 在 baseline admission 中继续保持：
  - `persistence = session_ephemeral`
  - `delete_semantics = runtime_authoritative_delete`
  - `runtime_reconciliation_required = false`
- baseline admission 不承诺 durable local `VoiceAsset` substrate，不得把 local generated handle 升格为跨重启 durable truth
- `audio.transcribe` 继续由独立 `STT` family 负责；当前 baseline default `STT`
  family 固定为 `Qwen3-ASR`，不得由 `qwen3_tts` workflow success 隐式覆盖

## K-VOICE-018 Agent Voice Output Policy

Agent voice output is Runtime-owned presentation policy whose AI consume intent
comes from Runtime Agent AI Config and whose stream/artifact execution belongs
to Runtime voice. Desktop, Zhiyu, and Avatar may render controls and consume
projections, but they must not decide provider route, model binding, voice
workflow choice, or whether a committed assistant message has voice semantics.

Minimum policy fields:

- `avatar_autoplay`: per-agent boolean persisted only on Runtime
  `AgentPresentationProfile`. When false, Avatar must remain text / expression /
  activity only for ordinary assistant turns.
- `desktop_autoplay`: fixed false for Desktop Agent Chat unless a later Desktop
  authority admits a user-facing setting. Desktop manual play is an explicit user
  request, not autoplay.
- `default_voice_reference`: agent-owned `VoiceReference` used by ordinary speech
  synthesis.
- `audio.synthesize` intent: Runtime Agent AI Config-owned TTS model route.
- `speech_route_policy`: local/cloud/unspecified route intent projected from
  Runtime Agent AI Config.
- `voice_artifact_retention`: durable local retention with user cleanup for
  generated turn audio.

Fixed rules:

- Runtime must not emit playable voice projection for an ordinary assistant
  message unless the effective playback target is admitted by policy and the
  speech route resolves to playable audio.
- Missing TTS model, missing/default voice reference, unhealthy route, provider
  failure, or unavailable voice workflow must complete the agent turn as normal
  text-only output unless another hard turn error exists.
- Text-only fallback must not emit fake `voice_playback_requested` success and
  must not materialize synthetic non-audio bytes under an audio artifact id.
- Runtime Agent AI Config owns `voice_workflow.voice_clone` /
  `voice_workflow.voice_design` intent. Runtime voice may create or update a
  `VoiceAsset` / `VoiceReference`, but ordinary assistant speech uses
  `audio.synthesize` with the effective `VoiceReference` unless a future runtime
  authority admits a provider-specific combined workflow.
- Voice identity follows the agent profile. Avatar asset, Avatar instance, and
  Desktop chat surface are projection layers and must not own voice identity.
- Agent Center hosts must not persist or mutate `voice.avatar_autoplay` in
  app-local or Kit-local config; controls write `AgentPresentationProfile`
  through the Runtime mutation surface.

## K-VOICE-019 Agent Voice Streaming And Interruption

Runtime owns voice stream lifecycle for active agent turns.

### Three-axis truth model

Agent voice must be described by three orthogonal axes. No axis may absorb
another.

- `execution_mode` (`ai.proto` `ExecutionMode`): `sync | stream | async_job`.
  This is transport/execution shape only.
- `voice_output_mode` (`tables/voice-enums.yaml` `output_modes`):
  `native_stream | simulated_stream | batch_final_artifact | text_only`. This is
  the positive, authoritative selected output-truth. A consumer must read this
  field, not infer realtime from event shape.
- `voice_playback_state` (`tables/voice-enums.yaml` `playback_states`):
  `active | completed | failed | interrupted | canceled`. This is the playback
  lifecycle axis.

Fixed rules:

- `voice_output_mode` is the single authoritative output-mode field. `failed`,
  `interrupted`, and `canceled` are `voice_playback_state` values and must never
  be encoded as `voice_output_mode`.
- Realtime acceptance requires positive `voice_output_mode = native_stream`.
  Absence of a boolean, or `stream_simulated = false` alone, is insufficient.
- `native_stream` means the provider/route emits playable non-final audio before
  full synthesis completion. Slicing a completed payload into chunks is
  `simulated_stream`, not native.
- `simulated_stream` must be positively marked as `voice_output_mode =
  simulated_stream`. Where the underlying scenario stream sets the compatibility
  boolean `stream_simulated = true` (`ai.proto` `ScenarioStreamCompleted`) or the
  local-engine audit tag `stream_fallback_simulated` (`K-LENG-011`), those remain
  compatibility metadata / audit tags only and must never be the primary realtime
  acceptance truth.
- `batch_final_artifact` and `text_only` are non-stream output modes.
  `text_only` must not emit a playable voice request or synthesize fake audio
  bytes (see `K-VOICE-018`).

### Identity and data plane

- Voice stream identity must stay tied to the same `agent_id`,
  `conversation_anchor_id`, `turn_id`, `stream_id`, and committed `message_id` as
  the text turn.
- Native realtime chunks use an admitted typed SDK voice-stream transport for
  transient non-final audio chunks. The current admitted Runtime data-plane is
  `RuntimeAgentService.SubscribeAgentVoiceStream`, surfaced by SDK as a typed
  agent voice stream consumer. Raw audio bytes must not be embedded directly in
  Runtime Agent app messages or presentation projection events; consumers read
  chunk bytes through that admitted streaming transport or Runtime artifact.
- Voice playback interruption uses
  `RuntimeAgentService.InterruptAgentVoicePlayback`. The command targets an
  active `voice_stream_id` and must cancel the provider stream / transient
  broker, then emit `runtime.agent.presentation.voice_playback_terminal` with
  `voice_playback_state = interrupted` while preserving
  `voice_output_mode = native_stream`. It must not be represented by local
  playback stop alone or by `runtime.agent.turn.interrupted`.
- Exactly one final durable audio artifact is persisted for replay/export when a
  voice stream completes successfully; it is owned by `RuntimeArtifactService`
  (`K-AGCORE-053`). Per-chunk durable artifact ids are NOT the default and require
  a separately admitted retention / cleanup / retrieval authority before use;
  until then Runtime must not mint one durable artifact per chunk.
- The final replay artifact must be `audio/*` with non-empty bytes and must obey
  the `ReadArtifactBytes` 32 MiB inline retrieval cap; oversized replay fails
  closed with `ARTIFACT_TOO_LARGE` unless chunked retrieval is separately admitted
  (`K-AGCORE-053`).

### Realtime-session boundary

- Ordinary agent custom-voice speech output is a scenario-layer `audio.synthesize`
  streaming path. It must not be produced by driving `RuntimeAiRealtimeService`
  directly as agent voice output. `RealtimeAudioChunk` (`ai_realtime.proto`) is a
  realtime-session field only and is not the agent voice stream chunk field or the
  scenario-stream delta field (`K-MMPROV-031`, `K-STREAM-004`).

### Interruption

- Runtime cancellation of an active turn must cancel the LLM stream, the TTS
  stream, queued voice chunks, and terminal playback projection as one accepted
  interruption truth, projected as `voice_playback_state = interrupted` while
  preserving the selected `voice_output_mode`.
- Voice-playback interruption is distinct from chat-turn interruption
  (`runtime.agent.turn.interrupted`); the latter alone does not prove voice
  playback was interrupted.
- Avatar interrupt is a request to Runtime. Avatar must not locally synthesize
  successful interruption; it may only stop local playback in response to
  Runtime terminal projection or an accepted Runtime cancellation response.

## K-VOICE-020 Durable Agent Voice Artifacts

Generated assistant voice audio is a Runtime artifact retained on the user's
local disk until explicit user cleanup or a future admitted quota policy removes
it.

Required metadata for generated agent voice artifacts:

- `agent_id`
- `conversation_anchor_id`
- `turn_id`
- `message_id`
- `voice_reference`
- `speech_model_id`
- `route_policy`
- `mime_type`
- `byte_digest`
- `created_at`
- `retention_scope`

Cleanup must be Runtime-owned and must support at least:

- delete generated voice artifacts by `agent_id`
- delete generated voice artifacts by `conversation_anchor_id`

Avatar must not own durable voice cache state. Desktop may expose cleanup UI, but
the cleanup action must call the Runtime-owned artifact/voice cleanup surface.
