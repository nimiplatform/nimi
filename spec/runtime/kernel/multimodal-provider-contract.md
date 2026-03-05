# Runtime Multimodal Provider Contract

> Owner Domain: `K-MMPROV-*`

## K-MMPROV-001 Canonical Common Head

多模态 canonical 请求头字段集合由 `multimodal-canonical-fields.yaml` 管理。

## K-MMPROV-002 Image Spec Contract

图像生成字段（prompt、size、quality、seed 等）必须在请求前可校验。

## K-MMPROV-003 Video Spec Contract

视频生成字段（duration/fps/resolution 等）必须在请求前可校验。

## K-MMPROV-004 TTS Spec Contract

语音合成字段（voice/language/format/rate）必须在请求前可校验。

## K-MMPROV-005 STT Spec Contract

语音转写字段（audio_source/language/timestamps）必须在请求前可校验。

## K-MMPROV-006 Async Job First-Class

异步任务（特别是视频/长音频）必须作为一等能力，遵循 `K-JOB-*`。

## K-MMPROV-007 Artifact Meta Contract

artifact 元数据字段集合由 `multimodal-artifact-fields.yaml` 管理，必须支持 URL 与 inline 双模式。

## K-MMPROV-008 Adapter Obligations

每个 provider adapter 必须实现请求映射、响应归一化、reason code 归一化。

## K-MMPROV-009 Cloud Route Constraints

cloud 模态路由必须显式可观测，不得伪造成功响应。

## K-MMPROV-010 Local Provider Constraints

local provider 的能力暴露必须与本地 engine/capability 合同一致。

## K-MMPROV-011 Workflow External Async

workflow 外部异步节点事件语义必须与多模态任务生命周期对齐。

## K-MMPROV-012 Validation & Fail-Close

字段不支持、策略不通过、provider 不可用时必须 fail-close。

## K-MMPROV-013 DashScope Voice Catalog Primary Path

DashScope TTS 的 voice 解析主路径必须由 `K-MCAT-*` catalog 驱动。兼容模式 voice endpoint 探测不得作为主路径。

## K-MMPROV-014 Cross-Layer Traceable Voice Diagnostics

TTS voice 解析与校验日志必须可观测 `catalog_source`、`model_resolved` 与 `voice_count`，用于 Runtime → SDK → Desktop/Mod 统一排障。

## K-MMPROV-015 DashScope Voice Legacy Bypass Forbidden

针对 DashScope，禁止以 legacy/hardcode voice 兜底绕过 catalog 校验。

## K-MMPROV-016 LocalAI Minimal Image Workflow Mapping

Runtime 在不引入 DAG 编排的前提下，必须支持 LocalAI 图像最简工作流（t2i/i2i）：

- t2i：当 `reference_images` 为空时，不下发 `file/files/ref_images`。
- i2i：`reference_images[0] -> file`，`reference_images -> files`，`reference_images[1:] -> ref_images`。
- `negative_prompt` 存在时，必须透传 `negative_prompt`；若 `prompt` 未包含 `|`，则下发 `prompt=positive|negative`。
- 本地路由（`local/*`）必须基于已选 backend（如 `local-localai` / `local-nexa`）推断 providerType，避免 adapter 误判。

## K-MMPROV-017 Nexa-Compatible Image Option Strategy

LocalAI image 路径必须提供 Nexa 常用参数的最佳努力兼容：

- `provider_options.step` 优先；`provider_options.steps` 在 `step` 缺失时映射到 `step`。
- `provider_options.mode` 优先；`provider_options.method` 在 `mode` 缺失时映射到 `mode`。
- 对当前路径无稳定同名请求字段的键（`guidance_scale` / `eta` / `strength`）不得 fail-close，必须以 ignored 形式可观测回传。
- image artifact `provider_raw` 必须至少包含：
  - `adapter`
  - `localai_prompt`
  - `source_image`
  - `ref_images_count`
  - `compat.applied_options`
  - `compat.ignored_options`
