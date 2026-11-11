<!-- nimi-docs: {"authority":["rule.nimi.runtime.remote-access.operation-carrier","rule.nimi.runtime.remote-access.asset-write-stream","rule.nimi.runtime.ai-provider.media-upscale-contract","rule.nimi.runtime.ai-provider.sdxl-controlnet-union","rule.nimi.runtime.ai-provider.minimax-h3-local-image","rule.nimi.runtime.ai-provider.hyperflow-h3-local-video"],"sources":["runtime/internal/grpcserver/remote_transport.go","sdks/typescript/runtime/remote-data-channel.ts","examples/sdk/09-media-jobs.ts","sdks/typescript/core/app/local-app-runtime-platform-ai.ts","apps/lab/src/lab/lab-only/upscale.ts"]} -->

# 多模态能力与资产托管架构

Nimi 为图像与视频生成、超分辨率、语音、音乐及视觉推理提供类型化 API。例如，App 可以上传一张小图，提交 `image.upscale` 任务，再把放大后的 PNG 保存到项目中。可用的输入方式由所选模型和执行路由决定。

## 请求与资源输入规范

分发多模态请求时，请使用标准 SDK 客户端接口：

- **结构化输入**：直接传入结构化提示词文本、媒体字节流或安全的资产引用，无需在应用逻辑中注入供应商私有请求头。
- **媒体适配器**：不同任务接受符合具体操作契约的专门多媒体载荷。例如，在允许 URL 输入的载体上，文本与视觉对话接受 HTTP/HTTPS 图片 URL 或已上传的产物引用（通过 SDK 产物上传 API 获取的 `artifact-ref`）；而视觉定位（vision-locate）等操作要求传入 `imageArtifactId`；语音克隆任务则接受满足时长与格式约束的参考音频 Buffer。系统不接收本地 `file://` URI 作为图片输入。

## 图像与视频超分辨率

`image.upscale` 和 `video.upscale` 是两项独立的能力意图，在原生 App 中对应 `image-upscale` 和 `video-upscale` Job 类型，均不需要提示词。先在 Home 准备匹配的模型，再保存 App 的 Local 意图。请求包含一个已上传的 `sourceArtifactId`、`scale: 2 | 4`，以及可选的整数 `seed`（0～2147483647）。省略种子时使用 42，显式传入 0 也有效。

| 能力 | 输入要求 | 输出与限制 |
| --- | --- | --- |
| `image.upscale` | 一张 PNG 或 JPEG，最大 32 MiB | 一张 PNG，宽高分别为原图的 2 倍或 4 倍，输出每边不超过 4096 像素 |
| `video.upscale` | 一个完整 MP4，最大 32 MiB；包含一路 H264 视频，标称帧率为 24、25 或 30 FPS；不超过 10 秒和 300 帧；可包含一路 AAC 音轨 | 一个 MP4，保留源帧数、顺序、时间戳和音轨；输出每边不超过 4096 像素，全部输出帧解码为 RGB 后合计不超过 512 MiB |

视频时间戳须从零开始递增。Runtime 会检查实际媒体、时间信息和解码后的输出大小；修改扩展名或 MIME 类型不能让不合规文件变得可用。超分模型会重建细节，不是逐像素保真的普通缩放。

当前本地实现要求 Windows amd64 和 NVIDIA 加速。RelayVSR 2x、4x 分别需要对应倍率的主模型与 VAE；SeedVR2 3B、7B Sharp 可选 2× 或 4×，仍属实验性支持。这两项能力目前没有 Cloud 实现。组件和平台要求见[本地模型指南](/zh/runtime/local-models#本地图像与视频模型)。

请按[开发环境安装](/zh/start/install)使用配套的源码构建 SDK、Kit 和 Runtime；包版本号相同不代表一定包含这些新增实现。下面的函数使用 App 已有的宿主客户端。提交前，将唯一的 `clientSubmissionId` 写入 App 存储，收到结果后保存 Job ID。若提交过程中无法获知结果，调用 `client.ai.scenarioJobs.lookupSubmission(clientSubmissionId)` 查询原请求，不要自动再提交一个任务。

<<< ../../../examples/sdk/09-media-jobs.ts#upscale

## 控制图与普通参考图

SDXL ControlNet Union ProMax 扩展的是 `image.generate`，没有新增能力 ID。它的 `controlImage` 包含本应用可读取的 `imageArtifactId`、明确的 `ImageControlType`，以及可选的 `strength`（0～2，默认 1）。预处理后的控制图必须与输出画布同尺寸。枚举从公开入口 `@nimiplatform/sdk/runtime/wire-types` 导出。

可用类型为 `OPENPOSE`、`DEPTH`、`SCRIBBLE`、`CANNY`、`NORMAL`、`SEGMENT`、`TILE` 和 `REPAINT`。上传前应准备好对应控制图；Runtime 不会自动进行姿态、深度或边缘检测。重绘输入须遵循模型的控制图约定，不保证蒙版外像素不变。目前 Canny 和 Tile 已在原生 Lab 实测，其余六种类型的真实模型执行仍为 **NOT-VERIFIED**。

使用下面的示例前，先在 Home 选用 SDXL ControlNet Union 配置，再提供一张 1024×1024 的 Canny PNG 和场景提示词。原生图像 Job 类型要求未使用的标准字段填空字符串或空数组，表示不启用相应控制选项：

<<< ../../../examples/sdk/09-media-jobs.ts#control

MiniMax-H3-Image 的普通编辑使用 `referenceImageArtifactId`，只传入一张已上传的参考图，不接受蒙版或负向提示词。文生图则提交 `image-generate` 和提示词，省略参考图。当前配方每次生成一张图，采用六步 Euler、CFG 1；默认画布为 1024×1024，宽高须为 32 的倍数。

<<< ../../../examples/sdk/09-media-jobs.ts#reference

ControlNet 请求不能同时携带普通参考图或蒙版。其他图像实现只有明确支持后才会接受 `controlImage`。通过界面测试两种输入方式的步骤见 [Lab 指南](/zh/start/use-nimi-lab#实测本地图像与视频模型)。

## 查询、取消和保存媒体任务

提交后持续查询原 Job，直到出现终态。观察失败不等于推理失败；失败、取消和超时任务都不能当成完整输出。停止轮询也不会停止推理：取消需要显式发送 Cancel，并查看后续任务状态。

下面的示例把完整产物接收到 App 私有存储，避免一次性将大文件全部读入渲染进程。请传入新的 App 相对路径，例如包含 Job ID 的项目路径，并保存返回的资产元数据。若保存过程中丢失响应，应先检查该路径，再决定是否保存；不要覆盖已有项目文件或自动重新生成。随后可通过 `client.storage.assets.read` 或 Kit 提供的媒体预览使用该资产。

<<< ../../../examples/sdk/09-media-jobs.ts#result

这些示例会使用工作区 SDK 进行类型检查，不是可独立运行的命令行程序。模型实测来自 2026-11-11 的 Windows RTX 5090 开发环境，通过 Desktop 监管的原生 Lab 使用 sd.cpp `master-1088-32d516c` 执行；结果不自动适用于安装版、macOS、远程 Web/Android 或其他模型与输入组合。

## 异步任务结果与结构化数据

多模态操作通常作为异步场景作业（Scenario Jobs）运行：

- **托管产物（Managed Artifacts）**：生成的图像、视频片段和音频文件由 Runtime 进行托管。应用可通过返回的产物 ID 读取或接收文件；`voiceAssetId` 用于引用音色，不是通用文件下载句柄。
- **结构化数据**：对于视觉定位（visual grounding）、语音转写（STT）等已准入操作，接口直接返回结构化 JSON 记录（如边界框、对齐时间戳、分类标签），方便程序直接解析使用。

## 资产托管与保留策略

- **完整性与访问控制**：由 Runtime 托管的媒体资产具备经过验证的 MIME 类型与 SHA-256 完整性哈希，并在应用之间实行严格隔离。
- **持久化建议**：Runtime 对生成的产物采用临时缓存策略。若应用需要在项目中长期保存资源，应在作业完成后将最终资产复制到应用的本地存储中。

## 远程 Web/Android 媒体

当前远程载体不接受类型化媒体字段中的原始 URL/URI，请使用内联字节或 App 有权限读取的 artifact/asset 引用，不要让 PC 代取客户端任意指定的地址。此外，存在能力合同并不代表远程载体已支持该操作；原生文件定位和尚未实现的双向实时会话应在界面上明确显示不可用。

App 资产写入采用有界 credit 下的增量输入，由原 owner 管理总量、配额和原子提交。取消操作或连接断开不会发布未完成的部分文件，也不会自动续传。已提交的持久 Job 应按现有标识查询状态，不要因断线而重复提交。

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`.nimi/spec/runtime/media-upscale.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/media-upscale.authority.yaml)
- [`examples/sdk/09-media-jobs.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/09-media-jobs.ts)
- [`sdks/typescript/core/app/local-app-runtime-platform-ai.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-ai.ts)
