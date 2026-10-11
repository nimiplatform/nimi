# Nimi Home 中的本地 AI 配置

在 Nimi Home 的「AI 能力」模块中，你可以直观地管理本机的 AI 模型资源与执行方案。这里不仅提供了官方精选的模型配置与社区分享推荐，还支持本地模型的导入、环境检测与默认运行方案（Loadout）配置。

## 核心功能分区

| 功能模块 | 主要操作 | 适用场景 |
| --- | --- | --- |
| **AI 能力工作区** | 浏览已配置能力、设定本机默认运行方案 | 为文本生成、向量化等能力指定推荐配置 |
| **模型库** | 查看本地模型文件、导入、完整性校验及空间清理 | 管理本地大模型文件与存储占用 |
| **环境依赖** | 查看运行本地模型所需的硬件驱动与推理引擎 | 检查 GPU 驱动、CUDA / Metal 加速支持 |
| **下载中心** | 跟踪应用扩展、模型权重和执行环境的下载进度 | 查看后台下载状态与网络吞吐 |
| **云服务连接** | 配置第三方云端 API Key 与兼容接入点 | 供应用或用户显式选择 Cloud 路由时连接云端服务 |

## 快速上手：配置本地模型

从导入模型到第一次发起调用的典型步骤：

1. **导入或下载模型**：在「模型库」中导入已有的 GGUF 等格式的模型文件，或通过下载中心获取官方验证过的模型。系统会自动校验文件的完整性。
2. **选择或创建 Loadout**：针对具体任务（如代码编写、日常对话），将模型与推理参数组合保存为一个「运行方案（Loadout）」。
3. **设为默认能力**：在「AI 能力」页面中，将该方案选为当前机器该能力的默认项。
4. **验证调用**：在支持该能力的 App 或桌面聊天中选择「本地（Local）」模式，该能力会使用已配置的本机模型执行。App 的在线功能、其他 Cloud 能力和外部连接仍有各自的数据流；选择 Local 不会让整个 App 自动变为离线应用。

## 状态指标说明

- **文件完整性**：验证模型文件哈希是否符合官方登记信息，确保下载未发生损坏。
- **环境就绪度**：综合检查本地硬件与底层推理引擎环境是否满足该模型的最低运行要求。
- **默认配置标记**：表示该能力在当前机器上的默认运行方案。修改默认配置后，所有选择使用 Local 模式的应用后续请求都会自动应用该默认方案；应用本身不提供覆盖机器 Loadout 的路径。

有关本地计算与运行方案的深度技术解析，请参阅[本地模型与 Loadout 规范](/zh/runtime/local-models)。

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
