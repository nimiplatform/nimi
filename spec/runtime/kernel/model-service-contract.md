# Model Service Contract

> Owner Domain: `K-MODEL-*`

## K-MODEL-001 ModelDescriptor 结构

`ModelDescriptor` 表示 runtime 级模型注册信息：

| 字段 | 类型 | 说明 |
|---|---|---|
| `model_id` | string | 模型唯一标识 |
| `version` | string | 版本 |
| `status` | ModelStatus | 模型状态 |
| `capabilities` | repeated string | 能力列表 |
| `last_health_at` | Timestamp | 最近健康检查时间 |
| `capability_profile` | ModelCapabilityProfile | 结构化能力画像 |

## K-MODEL-002 Model 状态枚举

| 状态 | 值 | 含义 |
|---|---|---|
| `INSTALLED` | 1 | 已安装，就绪 |
| `PULLING` | 2 | 下载中 |
| `FAILED` | 3 | 失败 |
| `REMOVED` | 4 | 已移除 |

## K-MODEL-003 ModelCapabilityProfile

9 个布尔标记描述模型支持的能力：

| 字段 | 含义 |
|---|---|
| `supports_text_generate` | 文本生成 |
| `supports_text_stream` | 文本流式生成 |
| `supports_embedding` | 向量嵌入 |
| `supports_image_generation` | 图像生成 |
| `supports_video_generation` | 视频生成 |
| `supports_speech_synthesis` | 语音合成 |
| `supports_speech_transcription` | 语音识别 |
| `supports_async_media_job` | 异步媒体作业 |
| `supports_streaming` | 通用流式支持 |

## K-MODEL-004 RuntimeModelService 方法集合

`RuntimeModelService` 方法固定为：

1. `ListModels` — 列出所有已注册模型
2. `PullModel` — 拉取模型（异步，返回 task_id）
3. `RemoveModel` — 移除模型
4. `CheckModelHealth` — 检查模型健康

## K-MODEL-005 PullModel 约束

- `app_id` 必填。
- `model_ref` 必填（模型引用标识）。
- `source` 可选（拉取源）。
- `digest` 可选（校验摘要）。
- 返回 `task_id` + `accepted` + `reason_code`。

## K-MODEL-006 CheckModelHealth 响应

- `healthy`：布尔健康状态。
- `reason_code`：失败原因。
- `action_hint`：建议操作（如 `restart`、`reinstall`）。

## K-MODEL-008 ModelStatus 状态机

`ModelStatus` 状态转换定义于 `tables/state-transitions.yaml` 的 `model_status` 机。合法转换：

| 源状态 | 目标状态 | 触发条件 |
|---|---|---|
| `INSTALLED` | `PULLING` | 拉取模型更新 |
| `PULLING` | `INSTALLED` | 拉取成功 |
| `PULLING` | `FAILED` | 拉取失败 |
| `INSTALLED` | `REMOVED` | 移除模型 |
| `FAILED` | `PULLING` | 重试拉取 |
| `FAILED` | `REMOVED` | 移除失败模型 |

不在此表中的转换为非法，实现必须拒绝。

## K-MODEL-007 与 RuntimeLocalRuntimeService 的关系

`RuntimeModelService` 和 `RuntimeLocalRuntimeService` 均涉及模型管理，但服务对象与抽象层次不同：

| 维度 | RuntimeModelService | RuntimeLocalRuntimeService |
|---|---|---|
| **抽象层次** | Runtime 级模型注册表 | 本地引擎级模型生命周期 |
| **管理对象** | 所有已注册模型（local + remote） | 仅本地模型（local engine 绑定） |
| **核心方法** | ListModels / PullModel / RemoveModel / CheckModelHealth | ListLocalModels / InstallLocalModel / StartLocalModel / StopLocalModel |
| **状态模型** | ModelStatus（K-MODEL-002） | LocalModelEntry 的 running/installed 状态（K-LOCAL-*） |
| **Phase** | Phase 2 Draft | Phase 1 Normative |

**数据流关系**：
- `RuntimeLocalRuntimeService.InstallLocalModel` 安装本地模型后，该模型应自动注册到 `RuntimeModelService` 的模型注册表（`ModelStatus=INSTALLED`）。
- `RuntimeModelService.PullModel` 用于拉取远程模型资源（如下载权重文件），与 `InstallLocalModel`（配置本地引擎绑定）互补。
- `RuntimeModelService.ListModels` 是模型的统一视图；`ListLocalModels` 是本地模型的详细视图（含引擎配置、端点等）。
