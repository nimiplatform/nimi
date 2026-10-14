# 本地模型管理与运行方案（Loadout）

在 Nimi 的本地计算架构中，模型权重文件只是保存在本地磁盘上的静态资产。要将模型转化为可用的计算能力，需要将其与推理引擎驱动、执行配方和运行参数组装为一个完整的「运行方案（Loadout）」。Runtime 为每项能力维护一个全局默认 Loadout，供所有声明 Local 意图的应用调用。

## 本地模型配置的推荐流程

1. **查看可用能力**：在 Nimi Home 的「AI 能力」中浏览系统支持的各项能力与运行参数。
2. **准备模型资源**：在「模型库」中导入本地 GGUF 模型，或通过「下载中心」获取推荐的模型权重。系统会自动通过 SHA-256 校验文件完整性。
3. **组装 Loadout**：针对具体场景（如日常对话或代码推理），配置上下文窗口大小、GPU 卸载层数等运行时参数，保存为具名的 Loadout。
4. **指定全局默认项**：将该方案设为本机该能力的默认运行方案。该设置会自动应用于所有路由至本地执行的应用。
5. **发起推理验证**：在应用的 AIConfig 中配置 Local 意图，发起真实请求验证端到端推理效果。

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
