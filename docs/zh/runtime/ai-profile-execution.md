# Profile、Loadout 与执行调度机制

AIProfile 是平台定义的可移植配置包。应用 AIProfile 时，系统仅将其作为推荐模板生成可供用户审阅与编辑的初始表单，并不会直接覆写既有的 AIConfig、切换本地 Loadout 或启动后台推理。

## 三种核心配置对象的职责

| 配置对象 | 职责与生命周期 | 安全与存储特征 |
| --- | --- | --- |
| **AIProfile** | 跨设备、跨应用分享的可移植能力配置模板 | 包含默认参数与推荐模型名，绝不包含任何本机私密信息或 API 密钥 |
| **AIConfig** | 每个应用独立拥有、或同账号下所有 LocalAgent 共享的权威能力配置 | 包含当前 revision、能力路由（Local / Cloud）与参数偏好，持久化存储于本地配置库 |
| **Loadout** | 本机硬件上具体能力的落地实现方案 | 严格绑定底层推理驱动（Driver）、参数优化模板（Recipe）及具体模型权重文件 |

每项能力在本地可维护多个备选 Loadout，但系统同一时刻仅将一个方案指定为本机默认项。对于采用 Local 路由的应用，AIConfig 仅声明使用本地模式，由 Runtime 自动路由到该默认 Loadout；对于 Cloud 路由，AIConfig 则精确指向已配置的云端连接器与模型接入点。

## 配置的生效与原子变更

修改机器默认配置需经过标准的准备与确认流程（Prepare / Commit）：
- 下载或导入模型文件仅扩展了本地资源库的可用清单；
- 将模型绑定为具体能力的 Loadout 并将其指定为系统默认项属于明确的系统设置行为；
- 该默认配置的变更将作用于所有后续使用 Local 模式的 AI 请求。

## 任务执行时的输入快照保证

为了确保任务在完整生命周期内使用一致的执行配置：
1. **输入快照固定**：当发起异步推理任务（Job）时，Runtime 会基于当时已生效的 AIConfig 与解析出的 Loadout 固化该任务的执行上下文，该任务持续使用提交时的配置；
2. **执行不受后续配置变动影响**：正在排队或执行中的任务将继续使用提交时固定的模型与参数，不会因用户在后台切换了配置而产生中途漂移或静默降级；
3. **确定性失败反馈**：当遇到资源缺失或环境不可用时，Runtime 会直接返回显式的错误代码与诊断报告，便于上层应用向用户清晰解释原因。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
