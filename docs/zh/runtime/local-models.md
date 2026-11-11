<!-- nimi-docs: {"authority":["rule.nimi.runtime.local-compute.r067","rule.nimi.runtime.ai-provider.r064","rule.nimi.runtime.ai-provider.media-upscale-contract","rule.nimi.runtime.ai-provider.sdxl-controlnet-union","rule.nimi.runtime.ai-provider.minimax-h3-local-image","rule.nimi.runtime.ai-provider.hyperflow-h3-local-video"],"sources":["config/runtime-managed-image-backend-packages.yaml","runtime/catalog/source/providers/local"]} -->

# 本地模型管理与运行方案（Loadout）

在 Nimi 的本地计算架构中，模型权重文件只是保存在本地磁盘上的静态资产。要将模型转化为可用的计算能力，需要将其与推理引擎驱动、执行配方和运行参数组装为一个完整的「运行方案（Loadout）」。Runtime 为每项能力维护一个全局默认 Loadout，供所有声明 Local 意图的应用调用。

## 本地模型配置的推荐流程

1. **查看可用能力**：在 Nimi Home 的「AI 能力」中浏览系统支持的各项能力与运行参数。
2. **准备模型资源**：进入所选模型的配置流程，下载缺少的权重，或选择本机已有且已校验的文件。配方支持的格式包括 GGUF、safetensors 等，下载时会校验声明的 SHA-256。
3. **组装 Loadout**：绑定全部必需组件，并检查适用于当前任务的设置。图像和视频模型可能分别需要主模型、编码器与 VAE；聊天模型的上下文窗口等参数并不适用于所有能力。
4. **指定全局默认项**：将该方案设为本机该能力的默认运行方案。该设置会自动应用于所有路由至本地执行的应用。
5. **发起推理验证**：在应用的 AIConfig 中配置 Local 意图，发起真实请求验证端到端推理效果。

## 本地图像与视频模型

当前 Windows amd64 NVIDIA 引擎包为 sd.cpp `master-1088-32d516c`，由 `master-1050-58bb3c1` 更新而来。Home 会准备 Runtime 管理的指定引擎与依赖；安装任意系统 `sd-cli` 或手工替换 DLL 不会更新所选 Loadout。macOS arm64 仍使用独立准入的 `master-1050-58bb3c1` Metal 包。下列新增配方目前只在 Windows 实现，不能把 Windows 的实测结果套用到 macOS；Linux 也没有这些配方可用的已准入 NVIDIA 引擎包。

| 模型或组件 | 能力 | 组件与使用方式 |
| --- | --- | --- |
| MiniMax-H3-Image | `image.generate` | 独立的 PDD 图像主模型、MiniMax-H3 Qwen3-VL 合并编码器 GGUF，以及专用图像 VAE；支持文生图或单参考图编辑，每次一张，不接受蒙版和负向提示词 |
| HyperFlow H3 Flash | `video.generate` | FL2VA、Ref2VA 合并 safetensors 主模型，H3 合并编码器、视频 VAE 和音频 VAE；当前采用六步 Euler、CFG 1 的蒸馏采样方案 |
| Sol-H3-VAE | `video.generate` 组件 | 可在 H3 视频路径中独立选择的视频 VAE，包括 HyperFlow；它不是独立生成能力，也不能替代 H3 Image 的专用图像 VAE |
| RelayVSR 2x / 4x | `image.upscale`、`video.upscale` | 选择与倍率对应的主模型和 VAE；2x 与 4x 的 VAE 不能互换 |
| SeedVR2 3B / 7B Sharp | `image.upscale`、`video.upscale` | 所选主模型加 SeedVR2 VAE，可选 2× 或 4×，仍属实验性支持 |
| SDXL ControlNet Union ProMax | `image.generate` | 包含编码器和 VAE 的完整 SDXL Base checkpoint，加独立的 Union ProMax checkpoint；使用一张与输出画布同尺寸的预处理控制图 |

H3 Image 可以复用已安装且兼容的 H3 编码器。HyperFlow 可以复用兼容的 H3 编码器、音频 VAE，并选择原版视频 VAE 或 Sol-H3-VAE。请在 Home 中逐个选择组件；文件名相似、下载来源相同都不能证明兼容。Runtime 会检查模型结构，RelayVSR 还会检查 VAE 声明的放大倍率。哈希校验通过表示文件完整，不代表它适用于所有配方。

2026-11-11 的 Windows RTX 5090 开发环境实测使用 H3 Image INT8 ConvRot、固定版本的 BennyDaBall HyperFlow 合并 INT8 转换权重、RelayVSR/SeedVR2 INT8 ConvRot，以及 SDXL/ProMax F16。原生 Lab 已实际完成 H3 文生图和单参考图编辑、HyperFlow FL2VA 与搭配 Sol 的 Ref2VA、四种超分模型及 ControlNet Canny/Tile。HyperFlow 四步/八步配置、另外六种 ControlNet 类型、其他量化版本和安装版仍为 **NOT-VERIFIED**。这些结果只覆盖相应样例，不代表通用重建质量或音频质量评测。

媒体限制及类型化字段见[多模态指南](/zh/runtime/multimodal)，首次操作可按 [Lab 步骤](/zh/start/use-nimi-lab#实测本地图像与视频模型)进行。使用这些源码新增能力需要配套构建的 SDK、Kit 和 Runtime；不能据此认定此前发布的包已经包含相同实现。

## 状态指标与诊断排查

为了便于系统监控与故障排查，各项状态指标对应了不同的生命周期阶段：

| 状态指标 | 代表含义 | 可能的状态值 |
| --- | --- | --- |
| **文件校验状态** | 本地文件字节哈希是否与已注册的哈希一致 | `verified` / `corrupted` / `unchecked` |
| **资源绑定状态** | 某个 Loadout 所需的模型权重、适配器与分词器资产是否齐全 | `complete` / `missing_assets` |
| **运行环境就绪度** | 本机 GPU 驱动、CUDA / Metal 运行时及依赖库是否满足要求 | `ready` / `missing_dependency` |
| **默认配置标记** | 当前方案是否已被指定为本机默认运行方案 | `active_default` / `inactive` |

Runtime 会为各个阶段提供具体的诊断反馈，让开发者和高级用户对本地推理栈的运行状态一目了然。

## 任务执行的稳定性保障

当应用提交推理任务时：
- **原子性参数固化**：Runtime 会记录包含当前 Loadout 参数、驱动选项与确切模型哈希的原子快照。
- **执行环境受控**：排队与执行中的任务严格基于该快照运行，提交后发生的配置变更不会影响正在执行的任务。
- **资源生命周期调度**：若在冷启动阶段检测到推理宿主进程未就绪，Runtime 会按需拉起进程，并根据本地内存策略管理其常驻生命周期。

## Source Basis

- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/media-upscale.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/media-upscale.authority.yaml)
- [`config/runtime-managed-image-backend-packages.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-managed-image-backend-packages.yaml)
- [`runtime/catalog/source/providers/local`](https://github.com/nimiplatform/nimi/blob/main/runtime/catalog/source/providers/local)
