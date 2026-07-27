# 语音资产生命周期

> 状态：运行中 (Running)。语音创建（克隆 + 设计）和 `VoiceAsset` 运行时管理对象在 `K-VOICE-*` 规范范围内发布。

Nimi 中的语音是一种运行时一流能力。语音创建（克隆 + 设计）和语音资产生命周期由运行时在 `K-VOICE-001..K-VOICE-018` 规范下拥有。本页涵盖了**资产侧**——`VoiceAsset` 是什么、如何创建、如何引用以及它与一次性语音合成有何不同。

## 语音创建范围

语音创建涵盖两种场景：

| 场景 (`Scenario`) | 功能描述 (`What it does`) |
| --- | --- |
| `voice_clone` (语音克隆) | 语音/音频 → 语音（基于样本） |
| `voice_design` (语音设计) | 文本 → 语音（基于描述） |

两者都通过统一的 `Scenario` 抽象提交：

- `SubmitScenarioJob`，其中 `scenario_type=VOICE_CLONE`
- `SubmitScenarioJob`，其中 `scenario_type=VOICE_DESIGN`

提供商私有参数**不会**自由传递；它们通过命名空间化的 `ScenarioExtension` 传递，并受扩展注册规则约束。

## VoiceAsset：运行时拥有的对象真相

`VoiceAsset` 是运行时管理的语音资源。最低要求字段：

| 字段 (`Field`) | 含义 (`Meaning`) |
| --- | --- |
| `voice_asset_id` | 运行时拥有的资产ID |
| `app_id` | 所属应用上下文 |
| `subject_user_id` | 所属用户（租户范围） |
| `workflow_type` | `voice_clone` / `voice_design` |
| `provider` | 后端提供商 |
| `model_id` | 创建时使用的提供商模型 |
| `target_model_id` | 资产绑定用于合成的模型 |
| `provider_voice_ref` | 提供商拥有的原生句柄真相 |
| `persistence` | 逻辑生命周期（`persistence_types`） |
| `status` | 资产状态（`asset_statuses`） |

`persistence` 和 `status` 枚举都定义在 `tables/voice-enums.yaml` 中。

`persistence` 描述了**逻辑**生命周期和句柄策略。它不自动承诺持久化本地存储；在持久化本地存储单独准入之前，本地生成的 `VoiceAsset` 可能仍是一个会话本地编排对象。

## 资产、引用与合成的对比

这是本页最重要的区别：

| 概念 (`Concept`) | 定义 (`What it is`) | 所有者 (`Owner`) |
| --- | --- | --- |
| `VoiceAsset` | 持久化的运行时拥有的语音资源 | 运行时 (`Runtime`) |
| `VoiceReference` | 合成调用用于识别要发声的语音的句柄 | 运行时 (`Runtime`) |
| `provider_voice_ref` | 提供商API内部的原生句柄 | 提供商 (`Provider`) |
| 语音合成 (`Voice synthesis`) | 使用 `VoiceReference` 生成音频的一次性 `tts_synthesize` 调用 | 运行时 (RPC) |

`VoiceAsset` 和 `provider_voice_ref` 必须保持分离。运行时不得将 `provider_voice_ref` 提升为公共主键。提供商不得绕过 `VoiceAsset` 成为运行时的用户资源真相。当提供商返回原生自定义语音句柄时，运行时会将其整合到 `VoiceAsset + VoiceReference` 公共契约中。

## VoiceReference 边界

合成入口点通过 `VoiceReference`。仅有三种已准入的引用类型：

| 类型 (`Kind`) | 用途 (`Use`) |
| --- | --- |
| `preset_voice_id` | 系统预设语音 |
| `voice_asset_id` | 用户创建的 `VoiceAsset` |
| `provider_voice_ref` | 提供商原生句柄（明确准入） |

引用类型枚举定义在 `tables/voice-enums.yaml` (`reference_kinds`) 中。

`VoiceReference` 可以嵌入到运行时拥有的 `AgentPresentationProfile` 中，作为代理的默认语音绑定。这种嵌入不会将语音工作流/发现/资产所有权转移到 `K-VOICE-*` 之外。

## 发现：两个独立通道

语音发现清晰地分为两个通道：

| 发现 API (`Discovery API`) | 返回内容 (`What it returns`) |
| --- | --- |
| `ListPresetVoices` | 系统预设语音目录 |
| `ListVoiceAssets` | 用户的 `VoiceAsset` 记录 |

调用者不得依赖单个混合API。当提供商同时支持全局预设和用户资产时，两个通道都保持可用——但运行时从不返回混合流结果。

`voice.discovery_mode` 目录设置绑定了发现职责：

- `static_catalog` → 仅通过 `ListPresetVoices` 进行预设发现
- `dynamic_user_scoped` → 通过 `ListVoiceAssets` 进行用户资产发现
- `mixed` → 两个通道都活跃，调用者需分别调用

## ScenarioJob 生命周期

语音创建是异步的。`ScenarioJob` 生命周期（状态机 + 事件流）与 `K-JOB-002` 对齐。语音不重复并行的作业状态表。

四个生命周期 RPC：

- `SubmitScenarioJob` — 启动克隆或设计作业
- `GetScenarioJob` — 轮询状态
- `CancelScenarioJob` — 取消进行中的作业
- `SubscribeScenarioJobEvents` — 流式传输事件

提供商原生的多步工作流（例如，`preview → create`）**必须**封装在一个 `ScenarioJob` 生命周期内。提供商内部步骤不会成为额外的公共 RPC。

## 租户隔离

`VoiceAsset` 默认按用户范围划分。跨 `app_id` 或跨 `subject_user_id` 访问将封闭失败。没有隐式的跨租户语音资产复用。

## 目标模型绑定

`VoiceAsset` 在创建时绑定 `target_model_id`。如果 `tts_synthesize` 稍后请求不同的目标模型，运行时将返回 `AI_VOICE_TARGET_MODEL_MISMATCH`。此绑定是契约性的；它不是一个建议性提示。

## 语音句柄策略

支持工作流的语音家族一旦准入，必须声明 `voice_handle_policy`。最低要求字段：

| 字段 (`Field`) | 来源 (`Source`) |
| --- | --- |
| `persistence` | `tables/voice-enums.yaml` 中的 `persistence_types` |
| `scope` | `tables/voice-enums.yaml` 中的 `handle_scopes` |
| `default_ttl` | 按家族 |
| `delete_semantics` | `tables/voice-enums.yaml` 中的 `delete_semantics` |
| `runtime_reconciliation_required` | 按家族 |

没有已准入 `voice_handle_policy` 的支持工作流的家族可能不被准入。

## 读者场景：用户克隆自己的语音

用户希望为代理克隆自己的语音。

1.  **提交克隆作业。** 应用调用 `SubmitScenarioJob({ scenario_type: VOICE_CLONE, ... })` 并传入音频样本输入。
2.  **作业生命周期。** 运行时通过已准入的 `ScenarioJob` 状态机执行；事件通过 `SubscribeScenarioJobEvents` 流式传输。
3.  **提供商原生预览/创建封装。** 提供商内部的预览-然后-创建步骤封装在一个 `ScenarioJob` 中——应用看到的是一个生命周期。
4.  **结果。** 运行时发出一个包含已准入字段的 `VoiceAsset` 和一个 `VoiceReference{ kind: voice_asset_id }`。
5.  **绑定到代理。** 应用将 `VoiceReference` 嵌入到 `AgentPresentationProfile` 中。代理现在默认使用克隆的语音进行发声。

## 读者场景：使用预设语音进行合成

应用希望代理使用预设语音说出一句一次性的话。

1.  **发现。** `ListPresetVoices` 返回包含 `preset_voice_id` 的目录。
2.  **构建 VoiceReference。** `{ kind: preset_voice_id, value: ... }`。
3.  **合成。** 运行时 `tts_synthesize` 调用使用该引用；不涉及 `VoiceAsset`（未创建用户资产）。
4.  **音频字节返回。** 运行时拥有工件字节；Avatar 的音频管道通过 `runtime.artifacts.readBytes` 消费。

合成是瞬态的。`VoiceAsset` 生命周期用于**持久化语音资源**——用户的克隆语音、设计的语音等。

## 读者场景：发现遵循通道分离原则

应用希望在设置 UI 中显示用户可用的语音。

1.  **两次调用。** 应用调用 `ListPresetVoices` 获取系统语音，调用 `ListVoiceAssets` 获取用户创建的语音。
2.  **分两部分渲染。** UI 根据 `discovery_mode` 边界将它们显示为独立的部分。
3.  **无混合 API。** 应用不应寻找单个“列出所有内容”的调用——不存在这样的调用，且通道分离是契约性的。

## 语音资产生命周期不涵盖的范围

-   它**不是**一次性合成调用。`tts_synthesize` 是瞬态的；`VoiceAsset` 是持久化资源真相。
-   它不会将预设和用户资产发现混合到一个流中。
-   它不允许提供商进入公共资产层面；`provider_voice_ref` 始终保留在 `VoiceReference` 内部。
-   它不会静默地跨越租户。用户范围是封闭失败的。
-   它不允许支持工作流的 TTS 家族替代 STT；`audio.transcribe` 根据 `K-VOICE-016` 家族级边界独立准入。

## 边界总结

| 关注点 (`Concern`) | 所有者 (`Owner`) |
| --- | --- |
| 语音创建工作流（克隆 + 设计） | 运行时 (`K-VOICE-001..002`) |
| `VoiceAsset` 对象真相 | 运行时 (`K-VOICE-004`) |
| `VoiceReference` 合成入口 | 运行时 (`K-VOICE-003`) |
| 提供商原生语音句柄 | 提供商 (`provider_voice_ref`) |
| 租户隔离 | 运行时 (`K-VOICE-006`) |
| 目标模型绑定 | 运行时 (`K-VOICE-007`) |
| 发现通道分离 | 运行时 (`K-VOICE-009`, `K-VOICE-013`) |
| 语音句柄策略 | 运行时 (`K-VOICE-015`) |
| 家族级工作流验证边界 | 运行时 (`K-VOICE-016`) |

## 来源依据

- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`config/runtime-voice-enums.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-voice-enums.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)