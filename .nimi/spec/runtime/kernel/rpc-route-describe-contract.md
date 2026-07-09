# RPC Route Describe Contract

> Owner Domain: `K-RPC-*`

Runtime route describe, typed result schema, producer derivation, fail-close, transport, voice workflow independence, voice asset lifecycle, and workflow family validation authority.

This file is a semantic split from `rpc-surface.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-RPC-015 Route Describe Logical Operation And Single Authority

`runtime.route.describe(...)` 是 runtime-owned 的逻辑操作，用于为单个 canonical capability route 生成 app-facing typed metadata projection。

- metadata authority 固定属于 Runtime；SDK、Desktop、host capability 只允许投影和消费，不得生成第二份 metadata 真相。
- `runtime.route.describe(...)` 的对象是“已解析 capability route 的 metadata”，不是新的 provider 探测面，也不是 Desktop heuristic。
- `describe` 返回的 metadata 只描述 capability policy / input / reasoning / workflow 语义；不得承载 health 成功语义、fallback 决策或 Desktop local cache truth。

## K-RPC-016 Route Capability Responsibility Split

route capability surface 的职责固定拆分如下：

- `runtime.route.listOptions(...)`：只返回可选择 binding/options；不产生 resolved binding、health 或 metadata truth。
- `runtime.route.resolve(...)`：只执行 selection -> resolved binding resolution；不得输出 health verdict 或 metadata policy truth。
- `runtime.route.checkHealth(...)`：只返回 resolved binding 的 health/readiness truth；不得补写 resolution 或 metadata。
- `runtime.route.describe(...)`：只返回 resolved route 的 typed metadata；不得承担 selection resolution、health 探测、provider fallback、或 Desktop-owned projection 组装。
- 对 `audio.synthesize` 与 `audio.transcribe`，`runtime.route.checkHealth(...)` 必须回答 capability-scoped readiness，而不是 generic `speech` provider/engine reachability。
- 对 plain speech，即使共享同一 `speech` engine，`audio.synthesize` 与 `audio.transcribe` 也允许 health truth 分离；任一 capability 缺失独立 admitted ready proof 时必须 fail-close。
- richer plain-speech health/readiness truth 不得被 Desktop/SDK 或其它消费面倒推出 `voice_workflow.voice_clone` / `voice_workflow.voice_design` admitted success；workflow independence 约束继续成立。

实现层允许共享底层 resolver/cached lookup，但 public contract 上述四者的语义边界不得合并。

## K-RPC-017 Route Describe Typed Result Schema

`runtime.route.describe(...)` 的 Phase 1 typed result 固定为 discriminated result：

- `capability`：canonical capability token（必须来自 `K-MCAT-024`）
- `metadataVersion`：固定为 `v1`
- `resolvedBindingRef`：由 `runtime.route.resolve(...)` 产生并可复核的 resolved binding reference；`describe` 不接受 Desktop heuristically assembled route
- `metadataKind`：`text.generate | image.generate | audio.synthesize | audio.transcribe | voice_workflow.voice_clone | voice_workflow.voice_design`
- `metadata`：与 `metadataKind` 对应的 typed object

`metadataKind=text.generate` 时，`metadata` 最小必填字段固定为：

- `supportsThinking: boolean`
- `traceModeSupport: 'none' | 'hide' | 'separate'`
- `supportsImageInput: boolean`
- `supportsAudioInput: boolean`
- `supportsVideoInput: boolean`
- `supportsArtifactRefInput: boolean`

`metadataKind=image.generate` 时，`metadata` 最小必填字段固定为：

- `supportedResponseFormats: string[]`
- `maxImagesPerRequest: number`
- `supportsNegativePrompt: boolean`
- `supportsReferenceImages: boolean`
- `supportsMask: boolean`
- `supportsSeed: boolean`
- `supportsSize: boolean`
- `supportsAspectRatio: boolean`
- `supportsQuality: boolean`
- `supportsStyle: boolean`

可选字段：

- `defaultResponseFormat`
- `providerExtensionNamespace`
- `providerExtensionSchemaVersion`

这些字段只表达 runtime canonical `ImageGenerateScenarioSpec` 的请求能力；
不得暴露 provider raw parameter allowlist、endpoint/path 覆写键、或 adapter
私有 schema。`image.generate` 的 execution surface 仍固定为 async
`SubmitScenarioJob` / artifact output；route describe probe 只允许返回 metadata，
不得创建第二条 image execution control plane。

`metadataKind=voice_workflow.voice_clone` 时，`metadata` 最小必填字段固定为：

- `workflowType: 'voice_clone'`
- `requiresTargetSynthesisBinding: boolean`
- `textPromptMode: 'unsupported' | 'optional' | 'required'`
- `supportsLanguageHints: boolean`
- `supportsPreferredName: boolean`
- `referenceAudioUriInput: boolean`
- `referenceAudioBytesInput: boolean`
- `allowedReferenceAudioMimeTypes: string[]`

可选字段：

- `providerExtensionNamespace`
- `providerExtensionSchemaVersion`

这两个字段只暴露 extension namespace/schema identity，不暴露具体
extension-key allowlist、transport override 键或 runtime-private schema
内容。

`metadataKind=voice_workflow.voice_design` 时，`metadata` 最小必填字段固定为：

- `workflowType: 'voice_design'`
- `requiresTargetSynthesisBinding: boolean`
- `instructionTextMode: 'unsupported' | 'optional' | 'required'`
- `previewTextMode: 'unsupported' | 'optional' | 'required'`
- `supportsLanguage: boolean`
- `supportsPreferredName: boolean`

可选字段：

- `providerExtensionNamespace`
- `providerExtensionSchemaVersion`

这两个字段只暴露 extension namespace/schema identity，不暴露具体
extension-key allowlist、transport override 键或 runtime-private schema
内容。

`metadataKind=audio.synthesize` 时，`metadata` 最小必填字段固定为：

- `supportedAudioFormats: string[]`
- `supportedTimingModes: ('none' | 'word' | 'char')[]`
- `supportsLanguage: boolean`
- `supportsEmotion: boolean`

可选字段：

- `defaultAudioFormat`
- `voiceRenderHints`
- `providerExtensionNamespace`
- `providerExtensionSchemaVersion`

`metadataKind=audio.transcribe` 时，`metadata` 最小必填字段固定为：

- `tiers: string[]`
- `supportedResponseFormats: string[]`
- `supportsLanguage: boolean`
- `supportsPrompt: boolean`
- `supportsTimestamps: boolean`
- `supportsDiarization: boolean`

可选字段：

- `maxSpeakerCount`
- `providerExtensionNamespace`
- `providerExtensionSchemaVersion`

Phase 1 未在本规则列出的 capability，不得借由自由对象、provider raw payload 或 Desktop 本地推导补充稳定 metadata contract。

## K-RPC-018 Route Describe Producer Derivation Rules

`describe(...)` metadata 必须单向派生自 runtime 既有 capability truth：

- `text.generate.supportsImageInput | supportsAudioInput | supportsVideoInput`
  - 单向派生自 `K-MMPROV-030` 的 multimodal preflight capability truth。
- `text.generate.supportsArtifactRefInput`
  - 单向派生自 runtime 对 `artifact_ref` 可解析后目标模态的 capability truth；Desktop 不得维护第二份 artifact modality matrix。
- `text.generate.supportsThinking | traceModeSupport`
  - 单向派生自 `K-MMPROV-037` 的 typed reasoning capability truth。
- `image.generate`
  - 单向派生自 source-authored `image_request_options` + resolved model
    `image.generate` catalog truth；local image route 可额外消费 local image
    supervised backend resolver 已验证的 runtime-private support class，但不得
    由 Desktop/SDK/provider adapter heuristic 推断。
- `voice_workflow.voice_clone | voice_workflow.voice_design`
  - 单向派生自 source-authored workflow `request_options` + `K-MMPROV-019`、`K-MMPROV-020`、`K-MCAT-013`、`K-MCAT-014`、`K-MCAT-021` 以及 local `speech` capability truth（含 `K-LOCAL-017`）。
- `audio.synthesize`
  - 单向派生自 source-authored `voice.request_options` + resolved model `audio.synthesize` catalog truth。
- `audio.transcribe`
  - 单向派生自 source-authored `transcription` + resolved model `audio.transcribe` catalog truth。

若 producer 需要读取 catalog projection、本地 capability resolver、或 workflow binding matrix，该读取仍属于 Runtime 内部单向投影，不得形成 Desktop-owned metadata cache truth。

## K-RPC-019 Route Describe Fail-Close Semantics

以下任一条件成立时，`runtime.route.describe(...)` 必须 fail-close：

- `capability` 不是 canonical capability token
- 输入缺失 `resolvedBindingRef`，或该 binding 不是 runtime-owned resolve truth
- `metadataKind` 与 `capability` 不匹配
- 缺失本规则要求的 typed field、discriminator、枚举值，或字段类型非法
- producer 无法从 runtime truth 导出 Phase 1 要求的 metadata 最小集
- workflow binding / synthesis binding compatibility 需要显式证明但未能解析
- workflow metadata 只能通过 `input_contract_ref` naming、runtime hardcoded allowlist、或 app-local heuristic 才能推断

fail-close 时不得：

- 伪造默认 `supportsThinking=false` / `supports*Input=false`
- 以 provider 名称、route kind、local/cloud 假设补猜 metadata
- 把 `audio.synthesize` metadata 冒充 `voice_workflow.*` metadata

## K-RPC-020 Route Describe Transport Boundary

`runtime.route.describe(...)` 在 Phase 1 只定义 logical operation 与 metadata authority，不定义新的 daemon 顶层 RPC method。

- `.nimi/spec/runtime/kernel/tables/rpc-methods.yaml` 在本轮不得新增 `DescribeRoute`、`GetRouteMetadata` 或等价顶层 RPC。
- app-facing transport 可以与 `resolve / checkHealth` 形态不完全对称，但该不对称只允许存在于 host/SDK typed projection 面。
- 若 host capability、SDK typed surface、或 runtime-private transport adapter 内部复用 runtime catalog/local resolver truth，它们仍必须保持单向投影，不得升级为第二份 authority。

## K-RPC-021 Voice Workflow Capability Independence

`voice_workflow.voice_clone` 与 `voice_workflow.voice_design` 在 selection / resolve / checkHealth / describe 上必须被视为独立 capability，而不是 `audio.synthesize` 的隐式附属面。

- selection truth 必须按 `voice_workflow.voice_clone`、`voice_workflow.voice_design` 各自 capability key 记录；不得复用 `audio.synthesize` 的 selected binding。
- `resolve(...)` 对 workflow capability 必须解析 workflow model binding；当 binding matrix 要求目标 synthesis model 时，还必须显式解析 compatibility，而不是继承 `audio.synthesize` 的任意 route。
- `checkHealth(...)` 对 workflow capability 必须检查 workflow driver/readiness；当 `requiresTargetSynthesisBinding=true` 时，还必须把目标 synthesis binding readiness 作为同一路径的组成条件。
- `describe(...)` 对 workflow capability 只返回 workflow metadata；不得返回 `audio.synthesize` 的 voice list/synthesis metadata 代替。
- workflow metadata 必须继续单向派生自 source-authored workflow metadata；不得借用 plain `audio.synthesize` / `audio.transcribe` metadata，亦不得因 provider/engine 共享同一 `speech` host 就推断 workflow metadata 存在。
- 任一 workflow capability 缺失独立 selection、resolution、health、或 metadata truth 时必须 fail-close，不得降级到 `audio.synthesize` 成功路径。
- 对 local workflow execution admission，workflow success 也必须保持 family-scoped：
  - baseline admitted family 当前固定为 `qwen3_tts`
  - `resolve(...)` / `checkHealth(...)` / `describe(...)` 对 `qwen3_tts` 的成功不得被解释为 generic local workflow success
  - 其它 local workflow family（包括 `voxcpm`、`omnivoice`）在未独立 admitted 前必须继续 fail-close

## K-RPC-022 VoiceAsset Lifecycle Boundary

`GetVoiceAsset` / `ListVoiceAssets` / `DeleteVoiceAsset` 只操作 runtime-managed `VoiceAsset` truth，不直接操作 provider-native handle truth。

- `provider_voice_ref` 可以作为 `VoiceAsset` 的内部字段或 `VoiceReference` 的一种来源存在，但仅限 Runtime 内部 / privileged / debug 面
- ordinary profile / SDK 公共绑定输入只接受 `preset_voice_id` 或 `voice_asset_id`；不得接受裸 `provider_voice_ref` 或未判别的自由字符串音色引用（`K-VOICE-003`）
- 但对外公共资产生命周期主对象固定为 `VoiceAsset`
- 调用方不得绕过 `VoiceAsset` 把 provider-native handle 当作公共资产主键

`DeleteVoiceAsset` 的公共契约必须受 `voice_handle_policy.delete_semantics` 约束：

- 对 `runtime_authoritative_delete`，runtime 删除 `VoiceAsset` 即构成公共删除成功
- 对 `best_effort_provider_delete`，runtime 允许先删除本地 `VoiceAsset`，provider cleanup 作为 best-effort follow-up
- 对未 admitted 的更强语义，必须 fail-close，不得借由模糊 ack 冒充成功

## K-RPC-023 Workflow Family Validation Boundary

workflow-capable speech family 的 app-facing consume 与健康验证必须保持 family-level 边界：

- workflow family 的 plain TTS / workflow 成功，不得被 host、SDK、Desktop、或 tests 隐式提升成 `audio.transcribe` 成功
- STT 必须继续由独立 STT family 的 resolved binding / health / execution truth 验证
- family-level acceptance matrix 若缺失独立 STT sentinel，则不得宣称整条 `tts + stt + voice_design + voice_clone` 链路已经 admitted
