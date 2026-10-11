# 受控操作执行机制（Execution Protocol）

Nimi 为外部工具调用与委派操作提供默认拒绝（Fail-Closed）的安全防护边界。该机制独立于基础的本地 AI 对话、记忆检索与日常运行时服务。

## 安全防护执行时序

当某个操作接口启用完整的执行安全边界时，严格按以下阶段顺序推进：

```
discover → dry-run → verify → commit → audit
```

| 执行阶段 | 阶段职责与安全结果 |
| --- | --- |
| `discover`（能力发现） | 仅枚举当前授权主体（Scoped Principal）可见且可调用的操作 |
| `dry-run`（演练预览） | 生成结构化的拟执行提案（Proposal），不产生任何实际状态副作用 |
| `verify`（策略核验） | 严格依据用户真实意图、权限策略与安全围栏核验提案 |
| `commit`（幂等提交） | 在严格的幂等性保护下，正式提交执行已确认授权的操作 |
| `audit`（审计归档） | 完整记录操作执行结果与溯源链路（Lineage） |

若 `verify`（策略核验）失败，流程立即终止，绝不进入 `commit` 阶段。若 `commit` 执行后的审计结果存在不确定性，系统立即触发故障闭锁（Fail-Closed）。任何高风险操作均不得跳过其所有者声明的安全检查环节。

## 所有权与安全边界

操作的权威所有者（Action Owner）统一定义允许的操作方法、输入约束、输出格式、风险等级与授权判决逻辑。Runtime 提供委派网关、用户审批流与输出防火墙，但绝不跨界接管 Realm 或第三方应用的权威业务状态。Nimi Home 或其他客户端宿主可以负责渲染审批弹窗与确认界面，但它们本身不作为最终操作的授权裁判方。

这条边界并不等同于通用的复杂工作流引擎（Workflow）、外部协议扩展（MCP）或公共工具目录。未来若有外部适配器复用此机制，仍需保持独立的所有权与非阻塞集成方式。

## 场景示例：受校验的写入操作流程

当外部扩展发起一项数据写入操作时：

1. **发现阶段（Discover）**：仅向调用方返回其当前权限范围内的受控操作定义；
2. **演练阶段（Dry-Run）**：生成包含参数细节的结构化提案，不产生任何持久化副作用；
3. **核验阶段（Verify）**：系统核验当前用户意图与安全策略，确认是否需要人工复核；
4. **提交阶段（Commit）**：确认无误后执行写入，并确保操作幂等（即便网络重试也不会重复写入）；
5. **审计阶段（Audit）**：记录操作流水与终态执行日志。

如果在第三步核验阶段未通过，流程在写入生效前立即停止，并向调用方返回标准结构化拒绝响应。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
