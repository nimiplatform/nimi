# 本地模型管理与运行方案（Loadout）

在 Nimi 的本地计算架构中，模型权重文件仅代表本地磁盘上存储的静态资产。而将模型真正投入运行，则需要将其与推理引擎驱动、量化方案和运行参数组装为一个完整的「运行方案（Loadout）」。Runtime 为每项能力维护一个全局默认 Loadout，供所有声明 Local 意图的应用调用。

## 本地模型配置的推荐流程

1. **查看可用能力**：在 Nimi Home 的「AI 能力」工作区中浏览系统支持的各项能力与配置选项。
2. **准备模型资源**：在「模型库」中导入已有的 GGUF 模型，或通过「下载中心」获取官方推荐的模型权重。系统会自动执行 SHA-256 完整性校验。
3. **组装 Loadout**：针对目标场景（如高速日常对话或高精度代码推理），配置上下文窗口大小、GPU 卸载层数等优化参数，保存为一个具名的 Loadout。
4. **指定全局默认项**：将该方案设为当前机器该能力的默认运行方案。该设置将自动应用于所有选择使用本地计算的 Nimi 应用。
5. **发起推理验证**：在应用中保存 Local 意图，执行实际请求验证端到端调用体验。

## 正确理解各阶段的状态指标

为了便于系统监控与故障排查，系统对各个阶段的状态作了明确区分：

| 状态指标 | 代表含义 | 典型状态值 |
| --- | --- | --- |
| **文件校验状态** | 本地文件字节哈希是否与官方注册信息一致 | `verified` / `corrupted` / `unchecked` |
| **资源绑定状态** | 某个 Loadout 所需的模型文件与辅助词表是否齐全 | `complete` / `missing_assets` |
| **运行环境就绪度** | 本机 GPU 驱动、CUDA / Metal 运行时是否满足最低要求 | `ready` / `missing_dependency` |
| **默认配置标记** | 当前方案是否已被选为全局默认方案 | `active_default` / `inactive` |

系统会根据实际环境提供精准的诊断信息，帮助开发者与高级用户明确系统状态。

## 任务执行的稳定性保障

当应用提交推理任务时：
- **原子性参数固化**：Runtime 会将选定 Loadout 的完整参数（包括确切的模型哈希、上下文长度）原子化写入该任务的执行上下文中；
- **执行环境受控**：排队与执行过程中的任务严格按照初始快照运行，确保提交后发生的配置变更不会影响正在运行的任务；
- **资源自适应调度**：若在冷启动阶段检测到推理进程未就绪，Runtime 会自动拉起推理宿主并在执行完成后根据内存策略优雅管理常驻周期。

## Source Basis

- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
