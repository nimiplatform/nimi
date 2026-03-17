# Music Scenario Extension Contract

> Owner Domain: `K-MMPROV-*`

## K-MMPROV-034 `nimi.scenario.music_generate.request` v1

`MUSIC_GENERATE` 可通过 `ScenarioExtension.namespace = "nimi.scenario.music_generate.request"` 承载 v1 iteration 扩展。该扩展仅定义以下字段：

- `mode`: `extend | remix | reference`
- `source_audio_base64`: iteration 模式必填
- `source_mime_type`: 可选
- `trim_start_sec`: 可选
- `trim_end_sec`: 可选

除上述字段外，runtime 不得把未知 key 继续下传 provider。

当请求携带该扩展时，runtime 必须额外校验模型在 catalog 中声明了 `music.generate.iteration` capability；未声明则必须 fail-close。

## K-MMPROV-035 Music Iteration Fail-Close

- 无扩展时，`MUSIC_GENERATE` 视为 prompt-only 路径。
- 扩展存在但 `mode` 非法、缺 `source_audio_base64`、base64 无法解码、trim 为负值、或 `trim_end_sec <= trim_start_sec` 时，runtime 必须返回 `AI_MEDIA_SPEC_INVALID`。
- provider 不支持该 iteration 语义时，runtime 必须返回 `AI_MEDIA_OPTION_UNSUPPORTED`。
- capability 已声明但 runtime 内部没有对应 provider strategy 时，仍必须返回 `AI_MEDIA_OPTION_UNSUPPORTED`。

## K-MMPROV-036 Capability-Gated Iteration Baseline

iteration 支持必须由 `music.generate.iteration` capability 与 runtime provider strategy 共同决定，不能只靠 provider 名字硬编码。

- `stability` 是当前官方闭源基线 provider，必须显式声明 `music.generate.iteration` capability，并消费 runtime 规范化后的 typed iteration 输入。
- `suno` 可保留为实验性路径；若继续声明 `music.generate.iteration`，也必须消费 runtime 规范化后的 typed iteration 输入，不得原样盲传未验证字段。
- `soundverse`、`mubert`、`loudly` 当前规范基线只要求 `music.generate` prompt-only；若未声明 `music.generate.iteration` capability，则带 iteration 扩展时必须 fail-close。
- `local` provider 当前规范基线只要求 prompt-only；`sidecar` 本地 backend 后续可在声明 capability 后增量开放 iteration。
- 本规则不新增新的顶层 RPC；iteration 继续复用通用 `ScenarioJob` / artifact 契约。
