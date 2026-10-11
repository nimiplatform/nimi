# 本地审计与安全日志架构

本地 Runtime 维护着一份结构化的本地安全审计账本，完整记录系统中的 AI 模型调用、权限验证决策、应用间协作事件及外部智能体动作。该审计账本默认安全保存在用户本机，真正实现本地优先与隐私自主掌控。

## 本地审计的核心覆盖范围

| 审计事件族 | 记录内容示例 | 业务价值 |
| --- | --- | --- |
| **AI 调用全流程** | 任务提交（Submit）、推理状态流转、最终成功或失败事件 | 追踪模型推理性能与异常耗时 |
| **模型调度与路由** | 本地推理引擎选择、云端 Connector 路由路径与参数快照 | 排查模型版本与加载参数 |
| **权限与安全决策** | Token 校验结果、权限范围检查、敏感操作拦截记录 | 安全审查与防越权分析 |
| **委派与工具调用** | 外部智能体建议的动作参数、输出防火墙判定、用户审批记录 | 完整的智能体行为追溯链条 |
| **记忆读写与同步** | 记忆条目沉淀、检索召回日志、记忆清空操作记录 | 掌握智能体的知识演变过程 |

每条审计记录均包含关联链路标识（Trace ID）、操作主体身份（Principal ID）及结构化时间戳，在本地存储配额保留期内持久保存，重启系统也不会意外丢失。

## 本地优先的设计考量

1. **隐私完全归属用户**：审计日志默认保存在受保护的本地 SQLite 数据库中，绝不会在未经用户允许的情况下上传至云端；
2. **离线完整可用**：无需依赖网络连接，即便在完全断网的离线环境中，所有操作审计依然完整可靠；
3. **可选的云端安全聚合**：在企业或受管团队环境中，用户可主动开启云端日志聚合功能，将脱敏后的统计信息同步至 Realm 进行安全集中审计。

## 故障复盘与排查场景：还原一次失败的推理请求

当用户反馈某次对话或生成任务异常中断时，排查人员可根据 Trace ID 进行端到端现场还原：
1. **定位 Trace ID**：从错误提示或应用控制台中提取该次调用的 Trace ID；
2. **检索任务流转**：查询该任务的状态流转链条（如 `SUBMITTED → RUNNING → FAILED`）；
3. **定位根本原因**：审计事件详细记录了当时调用的具体模型、路由链路及服务商返回的精确错误码（如上下文超限或超时），无需凭空推测即可迅速定位故障根因。

## Source Basis

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
