# 委托客户端 (Delegation Client)

> 规范状态：底层核心契约已标准化；对外能力以 SDK 官方发布的导出接口为准。

运行时委托客户端在 SDK 内核层面规范了 SDK 消费者如何与 Runtime 委托网关 (Delegation Gateway) 及输出防火墙 (Output Firewall) 安全协同。只有在 SDK 公开导出的包中出现的接口，方可作为公开 API 调用。

## 核心定位与职责

委托客户端是专为对接外部委托能力的应用程序或扩展模块设计的 SDK 交互表面。它允许应用向 Runtime 委托网关提出结构化的观察报告、信息查询、行动意图、工具调用请求、UI 呈现更新、产物创建建议或受控沙盒测试。

**所有建议均必须经过 Runtime 输出防火墙的全面安全审查**（参阅 [Runtime 委托能力](/zh/runtime/delegated-capability)）。SDK 严格阻断任何未经防火墙过滤的外部提议直接触达业务消费端。

## 接口方法速查

| 方法 | 核心定位与用途 |
| --- | --- |
| `OBSERVE` | 提交强类型的环境或行为观察事实 |
| `QUERY` | 提交强类型的信息查询请求 |
| `SUGGEST_INTENT` | 建议或提议一个高阶业务意图 |
| `SUGGEST_TOOL_REQUEST` | 提议调用特定的工具函数 |
| `SUGGEST_PRESENTATION` | 建议更新 UI 呈现状态或展示布局 |
| `CREATE_ARTIFACT` | 提议创建或持久化一个产物文件 (Artifact) |
| `CONTROLLED_TEST` | 在受控隔离的沙盒中执行安全验证测试 |

上述所有方法均表达为**提议 (Suggestions) 或观察 (Observations)**，绝非应用端的单方面状态变更。

## 无隐式降级开关

SDK 接口在设计上明确不暴露任何手动的路由或 Provider 降级回退开关。底层 Runtime 严格保持既定操作的目标锁定与强类型错误语义：未通过防火墙安全审查的委托提议，将被立即返回为明确的类型化错误结果，而绝不会在后台静默切换至其他 Provider 进行不可信重试。

## 典型场景：应用提议执行工具调用

由外部 AI 模型驱动的业务模块试图发起一次工具调用：

1. **发起建议**：模块调用 SDK 接口 `delegationClient.suggestToolRequest(...)`。
2. **网关准入校验**：Runtime 委托网关根据当前 Provider Profile 的信任评级验证请求合法性。
3. **输出防火墙安全审查**：防火墙执行数据 Schema 校验、溯源验证、描述符哈希校验、敏感度数据分级以及提示词注入 (Prompt Injection) 风险排查。
4. **生成安全判定**：返回强类型判定结果（如 `ACCEPTED_SUGGESTION` 批准采纳、`APPROVAL_REQUIRED` 需用户确认、`QUARANTINED` 隔离阻断等）。
5. **执行与回传**：若通过判定，Runtime 在自有的完整审计溯源链条下调度执行，并通过 SDK 将结构化执行结果安全回传给应用。

## 核心设计准则

- 任何外部提议均严禁绕过输出防火墙直接执行。
- 接口层不提供手动的 Provider 隐式回退或静默容错重试。
- 业务消费层代码不得在未获网关批准的前提下直接执行外部提议。
- 契约校验失败时立即报错拒绝，不执行未经校验的跨 Provider 重试。

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
