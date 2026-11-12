<!-- nimi-docs: {"authority":["rule.nimi.platform.app-ecosystem.lab-web-carrier","rule.nimi.runtime.ai-provider.media-upscale-contract","rule.nimi.runtime.ai-provider.sdxl-controlnet-union","rule.nimi.runtime.ai-provider.minimax-h3-local-image","rule.nimi.runtime.ai-provider.hyperflow-h3-local-video"],"sources":["apps/lab/README.md","apps/lab/NIMI_APP.md","apps/lab/package.json","apps/lab/src/lab/lab-only/upscale.ts","apps/lab/src/studio-modules/studio-media/parameter-panel.tsx"]} -->

# 使用 Nimi Lab

`apps/lab/` 是 Nimi 官方的能力实验台（Capability Workbench）。作为一个完整的 Nimi App，它集成了 SDK、Kit、Runtime、Realm 与 App Tools 的最新能力，方便开发者在新特性正式纳入项目模板前，先行体验端到端流程并验证集成方案。

Nimi Lab 可作为平台能力集成的参考实现。其中涉及的权限校验、会话令牌、模型调度与数据持久化等核心机制，均严格遵循平台统一的架构边界与安全契约。

## 运行与调试

按[开发环境安装](/zh/start/install)完成准备，启动 Runtime 和 Nimi Home 并登录后，在仓库根目录的另一个终端执行：

```bash
pnpm dev:lab
```

若在 `apps/lab/` 目录下操作，可使用以下常用工程脚本：

```bash
pnpm dev:shell      # 在官方 Electron 宿主容器中启动应用
pnpm run validate   # 校验 App 清单与访问声明
pnpm run typecheck  # 运行 TypeScript 类型检查
pnpm run test       # 运行单元测试与集成测试
```

在 Windows 和 macOS 上，Nimi Lab 运行在桌面端监管的 Electron 开发环境中。本地开发构建可通过 Nimi Home 的开发者模式（Developer Mode）完成注册并检查访问就绪状态。Lab 直接在根工作区维护，不运行脚手架 init/sync，也没有公开发布流程。

## 实测本地图像与视频模型

请使用同一工作区构建的 Desktop/Runtime、SDK、Kit 和 Lab，按上文的监管启动命令打开原生 Lab。Apple Silicon 的官方 sd.cpp 1088 包会在 CPU 上执行 INT8 ConvRot 算子。各组合的开发环境实测结果见[本地模型指南](/zh/runtime/local-models#本地图像与视频模型)。这些模型路径在远程浏览器和安装版中仍为 **NOT-VERIFIED**。

1. 在 Home 的 **AI 能力** 中选择 **图像生成**、**视频生成**、**图像超分辨率** 或 **视频超分辨率**。选好模型，下载缺少的组件，并选择可复用的本机兼容文件。等待准备完成，再将配置设为本机当前模型。文件下载完成不等于模型已就绪。
2. 在 Lab 打开对应入口，把该能力的 AI 意图设为 **本地**，核对“下次运行”显示的模型。图像超分和视频超分各有独立的能力配置，切换其中一项不会替另一项选模型。
3. 打开 **参数**，按任务准备输入：

| 任务 | 输入与操作 |
| --- | --- |
| H3 文生图 | 在图像生成中输入场景提示词，参考图、控制图、蒙版和负向提示词均留空，然后生成 |
| H3 单参考图编辑 | 在普通 **参考图文件** 中上传一张图片，描述修改要求；控制图和蒙版留空 |
| RelayVSR 或 SeedVR2 超分 | 图像超分上传 PNG/JPEG，视频超分上传完整 H264/AAC MP4；选择 2× 或 4×，RelayVSR 必须与配方倍率一致；种子可留空 |
| SDXL ControlNet Union | 上传预处理后的 **控制图文件**，选择控制类型，输出画布尺寸与控制图一致；Canny、Tile 已实测，强度留空时为 1 |
| HyperFlow 视频 | 在视频生成中使用文本提示词或受支持的参考图模式；在 Home 准备 FL2VA/Ref2VA 组件，并选择原视频 VAE 或 Sol-H3-VAE |

4. 发起任务，完成后查看图片或播放视频。排队、运行中、已下载模型或旧历史记录，都不等于这次生成成功。失败和取消会保留实际状态。停止推理请使用任务的取消操作，离开页面或停止观察并不等于取消。
5. 从历史中重新打开已保存结果。更换源文件时需重新选择输入。切换 ControlNet 和普通编辑前，先重置参数，确保下一次请求只包含需要的输入方式。

建议先用小图或短视频测试。超分输入最大 32 MiB；视频还须满足不超过 10 秒/300 帧、标称 24/25/30 FPS，以及最多一路 AAC 音轨。完整限制见[多模态指南](/zh/runtime/multimodal)。ControlNet 不会自动预处理控制图，重绘也不保证蒙版外像素保持不变。

2026-11-11 的 Windows RTX 5090 原生开发环境已实际生成 H3 文生图/编辑、HyperFlow FL2VA 与搭配 Sol 的 Ref2VA、RelayVSR 2x/4x、SeedVR2 3B/7B Sharp 和 ControlNet Canny/Tile 结果。SeedVR2 仍属实验性支持；其余 ControlNet 类型、HyperFlow 四步/八步配置、其他平台和安装版仍为 **NOT-VERIFIED**，详见[模型支持范围](/zh/runtime/local-models#本地图像与视频模型)。

## 关键代码与架构参考

| 探索方向 | 对应源码路径 |
| --- | --- |
| 工作区脚本与本地检查 | `apps/lab/package.json` |
| 受保护的 Shell 宿主通信与路由 | `apps/lab/README.md` 与 shell 路由模块 |
| AIConfig 存储与应用数据隔离 | `apps/lab/src/lab/lab-ai-config-store.ts` |
| 基于能力意图（Capability Intent）的 Runtime AI 调度 | `apps/lab/src/lab/lab-runtime.ts` |
| 结构化错误处理与异常状态映射 | `apps/lab/src/lab/lab-non-success.ts` |
| AI 配置面板 UI 组件设计 | `apps/lab/src/lab/workbench/lab-ai-config-settings-panel.tsx` |
| 平台契约一致性测试套件 | `apps/lab/test/lab-contract/` |

## 实践要点

- **保持应用身份独立**：应用标识 `nimi.lab` 专属于 Nimi Lab；开发自定义应用时必须声明独立的唯一 App ID。
- **隔离测试数据与夹具**：Lab 中的测试夹具（fixtures）、模拟数据与诊断信息仅用于探索与调试，自研应用应根据业务需求设计独立的数据模型。
- **按需渐进式引入**：建议先在 Lab 中评估和验证新能力，再结合自身产品场景，将成熟的实现模式迁移到自己的应用中。
- **提供可操作的状态引导**：参考 Lab 的交互方式，向用户展示结构化的运行状态（例如提示启动服务或检查访问状态），在流程受阻时给出明确的下一步操作指引。

## 常见状态反馈对照

| 状态码 | 业务含义 | 推荐提示方案 |
| --- | :--- | :--- |
| `runtime-unavailable` | 本地 Runtime 服务未响应。 | 检查本地 Runtime 与 Nimi Home 是否已启动。 |
| `principal-unauthorized` | 当前会话或调用主体未获准执行该操作。 | 检查 Nimi Home 的登录与该应用的 Nimi Access 状态，并核对 `nimi.app.yaml` 中所需的访问声明；AI 调用需要 `runtime.consume`。 |
| `input-invalid` | 输入参数或提示词缺失、格式不合规。 | 提示用户检查必填参数与输入格式。 |
| `sdk-method-unavailable` | 当前构建版本未暴露该能力。 | 提示更新 SDK 依赖包版本。 |
| `runtime-call-failed` | 请求处理过程中发生底层错误。 | 展示清晰的错误说明，并保留诊断日志供排查。 |

## 浏览器中的 Lab

Lab 也提供已声明的 HTTPS Web 入口，复用同一套工作台，并按普通远程 App 的准入流程连接主 PC Runtime。配置与启动步骤见 [Lab README](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md) 及 [Web 指南](/zh/start/connect-web-app)。使用时需满足匹配的源码包、正式登录、来源确认以及可直连网络等条件。

Web 端提供已实现的 AI 工作台、App AIConfig、运行记录、Agent Center、对话和受限文件操作。原生 App Access 诊断、集成、实时媒体、World Tour 和 PC 文件定位等功能仍需使用原生 Lab；具体以当前 App 入口显示的支持范围为准。关闭页面会结束实时调用，已提交的持久 Job 可通过原标识查询。

## Source Basis

- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`apps/lab/src/lab/lab-runtime.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-runtime.ts)
- [`apps/lab/src/lab/lab-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-ai-config-store.ts)
- [`apps/lab/src/lab/lab-non-success.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-non-success.ts)
- [`apps/lab/NIMI_APP.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/NIMI_APP.md)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/media-upscale.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/media-upscale.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`apps/lab/src/lab/lab-only/upscale.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-only/upscale.ts)
- [`apps/lab/src/studio-modules/studio-media/parameter-panel.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/studio-modules/studio-media/parameter-panel.tsx)
