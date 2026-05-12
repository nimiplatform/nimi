# Local Engine Speech Contract

> Owner Domain: `K-LENG-*` speech-specific local engine rules.
> Companion authority to `local-engine-contract.md`; this file owns the speech
> extracted from the former speech subsections of `local-engine-contract.md`.

## Speech Engine Family Line

`speech` 是本地语音引擎族。当前 ordinary-user admitted baseline 固定围绕 baseline `Qwen3` family line：

- `audio.transcribe` default lane: `Qwen3-ASR-0.6B`
- `audio.synthesize` default lane: `Qwen3-TTS-12Hz-0.6B-CustomVoice`
- `voice_workflow.voice_clone`、`voice_workflow.voice_design` 只有在真实本地 workflow execution plane 被显式 cutover admitted 后才能升格为 local truth
- 当前 baseline admitted local workflow family 边界固定为 `qwen3_tts`，不得被扩写成 generic local workflow truth

## Speech Runtime Mode Product Posture

Speech product posture:

- ordinary-user canonical local speech path 固定为 `engine=speech + SUPERVISED`
- ordinary-user canonical local speech path 必须按 bundle-shaped `Local Speech` setup surface 理解；desktop 不得把它投影成 generic verified model rows，或把 env/bootstrap/host 拆成独立用户安装对象
- 当 ordinary-user 缺失 local speech bundle slice 时，显式 `Download` 用户确认是唯一允许的启动信号；在用户确认前，desktop/runtime 不得因 capability 选择、route 尝试或被动探测而静默执行 env/bootstrap、host bring-up 或 capability 下载
- 用户确认后，runtime 可以复用已存在的 env/cache/host/slice；不得默认重装、重引导或重下载
- capability materialization 必须保持按 capability 懒加载；一次 `audio.synthesize` / `audio.transcribe` 请求或点击不得顺手预取全部 speech slices
- `speech + ATTACHED_ENDPOINT` 只允许作为高级/自托管路径存在，不得在产品语义上与 supervised 等价

## Speech Supervised Baseline

`speech` 管理 baseline local speech supervised families，并负责当前 admitted 语音基础能力探测。ordinary-user supervised truth 当前只承认 `audio.transcribe` / `audio.synthesize`；在 admitted local plain-speech execution plane 尚未 materialize 前，speech supervised `/healthz` 与 `/v1/catalog` 必须保持 placeholder/non-ready，plain-speech write routes 必须 fail-close。baseline supervised family line 固定为：

- `qwen3_asr`：default local `STT` family，普通用户默认 lane 为 `Qwen3-ASR-0.6B`
- `qwen3_tts`：default local synth / workflow family
  - plain synth default lane: `Qwen3-TTS-12Hz-0.6B-CustomVoice`
  - clone workflow default lane: `Qwen3-TTS-12Hz-0.6B-Base`
  - design workflow default lane: `Qwen3-TTS-12Hz-1.7B-VoiceDesign`
- baseline local `Qwen3` speech env topology 固定为 explicit split supervised envs：
  - `Qwen3-TTS` synth / workflow checkpoints 共享同一 `qwen3_tts` env line
  - `Qwen3-ASR` 使用独立 `qwen3_asr` env line
  - runtime 不得假设 `qwen-tts` 与 `qwen-asr` 可在同一 canonical supervised env 中共装
- `Qwen3-ASR-1.7B` 只作为 optional premium candidate 保留；在独立 premium admission 前不得自动 materialize 为 ordinary-user canonical default
- workflow-capable local family 只有在对应 local workflow execution plane 被显式 admitted 后才能进入 canonical local speech truth；当前 baseline admitted family 边界固定为 `qwen3_tts`
- ordinary-user supervised local speech install/readiness 语义固定分三层，且不得塌缩成单一“speech model installed” bit：
  1. `env/bootstrap readiness`：`qwen3_tts` / `qwen3_asr` env root、launcher、stable cache root 已就绪
  2. `host readiness`：受管 speech host 可提供 admitted health/catalog proof
  3. `capability materialization`：仅被请求 capability 对应的权重/工件已 materialize
- `env/bootstrap readiness` 与 `host readiness` 不是独立 ordinary-user install object；它们属于 runtime-owned local speech bundle download/init flow 的内部分层
- ordinary-user supervised path 必须先经过显式 `Download` 用户确认，才允许启动缺失的 env/bootstrap、host bring-up 或 capability materialization
- capability materialization 默认按 requested capability 懒加载：
  - `audio.transcribe` 只 materialize 当前 admitted `qwen3_asr` slice
  - `audio.synthesize` 只 materialize 当前 admitted `qwen3_tts` plain synth slice
  - future-admitted `voice_workflow.voice_clone` / `voice_workflow.voice_design` 也必须分别按自身 slice 懒加载，不得因为 plain `TTS` 已请求就自动预取
- runtime/desktop 必须复用已验证的 env/cache/materialized slice；除非 repair/remove 明确要求，否则不得默认重下载或重 bootstrap
