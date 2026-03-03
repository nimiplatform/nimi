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
