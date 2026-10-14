# Nimi Home 中的本地 AI 配置

在 Nimi Home 的「AI 能力」工作区中，你可以集中管理本机的 AI 模型资源与执行方案。该模块提供精选推荐配置、社区方案参考、本地模型导入、运行环境检测，以及整机默认运行方案（Loadout）的设定。

## 核心功能分区

| 功能模块 | 主要操作 | 用途 |
| --- | --- | --- |
| **AI 能力工作区** | 浏览已配置能力、设定本机默认运行方案 | 为文本生成、向量化等能力指定首选执行方案 |
| **模型库** | 查看本地模型文件、导入、完整性校验及清理磁盘空间 | 管理本地模型权重、GGUF 文件与存储配额 |
| **环境依赖** | 检查推理引擎与硬件加速依赖的前置条件 | 验证 GPU 驱动、CUDA、Metal 或 Vulkan 支持 |
| **下载中心** | 跟踪模型权重、应用及环境依赖的后台下载进度 | 监控下载进度、速率与网络吞吐 |
| **云服务连接** | 配置第三方云端 API Key 与兼容接入点 | 在应用或用户显式选择 Cloud 路由时提供云端执行目标 |

## 快速上手：配置本地模型

从导入模型到发起首次调用的典型流程：

1. **导入或下载模型**：在「模型库」中导入已有的 GGUF 等格式权重文件，或直接下载经过验证的模型。系统会在传输完成后校验完整性哈希。
2. **选择或创建 Loadout**：针对具体任务（如聊天、代码编写、推理），将模型与优化后的推理参数组合保存为命名「运行方案（Loadout）」。
3. **设为能力默认项**：在「AI 能力」面板中，将该 Loadout 标记为当前机器该能力的默认运行方案。
4. **发起调用验证**：在支持该能力的 App 或桌面聊天中选择「本地（Local）」模式，该能力将交由已配置的本机模型执行。App 的在线功能、其他云端能力及外部连接仍保持各自独立的数据流；选择 Local 不会将整个 App 变为离线应用。

## 状态指标说明

- **文件完整性**：校验已下载文件的哈希值与登记校验码是否一致，防止模型权重损坏。
- **环境就绪度**：确认本机硬件、驱动及底层推理引擎依赖是否满足模型运行要求。
- **默认配置标记**：指示该能力在当前机器上的活跃默认方案。修改默认方案后，所有路由至本地计算的应用后续请求都将统一生效；应用本身不提供覆盖整机 Loadout 的入口。

有关本地计算机制与运行方案的深入技术解析，请参阅[本地模型与 Loadout 规范](/zh/runtime/local-models)。

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
