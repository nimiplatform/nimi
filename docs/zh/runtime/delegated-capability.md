# 委派能力

Runtime 拥有外部 AI 宿主（另一个 AI Provider、一个挂着 MCP 工具的 Agent、一个未来的 A2A peer）在平台上动手所必经的闸口与输出 firewall。这页讲委派的 Runtime 侧。产品侧框架见 [Platform → AI Last Mile](/zh/platform/ai-last-mile) 与 [Platform → Agents → 外部 Agent](/zh/platform/agents/external-agents)。

## 委派 Session

外部 AI 想动作时，Runtime 给它开一段**委派 session**。Session 有类型化身份、信任 tier、策略快照、明确的生命周期。

| 性质 | 值 |
| --- | --- |
| 身份 | 类型化的外部 principal id |
| 信任 tier | `CONTROLLED_LOCAL` / `USER_ADDED_REVIEWED` / `ORG_MANAGED` / `BLOCKED` |
| 策略快照 | Session 打开时冻结 |
| 生命周期 | `OPEN → PAUSED_FOR_APPROVAL → CLOSING → CLOSED|FAILED` |

信任 tier 决定策略快照的形状。审批要求、敏感度阈值、隔离触发条件都从信任 tier 读。

## Provider 生命周期

外部 Provider 生命周期在 Runtime 里准入：

| 状态 | 含义 |
| --- | --- |
| `REGISTERED` | Provider 已被准入 |
| `DISCOVERING` | 能力探测中 |
| `READY` | Provider 健康可达 |
| `DEGRADED` | 可达但可靠性下降 |
| `DISABLED` | 显式禁用 |
| `QUARANTINED` | 因漂移或策略违规被隔离 |
| `REMOVED` | 已移除 |

如果某个 Provider 在 session 中途漂移（descriptor hash 变了），Runtime 自动把它搬到 `QUARANTINED`。漂移之后没有静默继续。

## 类型化委派请求

外部 AI 发来的是类型化委派请求：

| 请求 | 用途 |
| --- | --- |
| `OBSERVE` | 报告一条观察 |
| `QUERY` | 提出一个类型化的问题 |
| `SUGGEST_INTENT` | 建议一个意图 |
| `SUGGEST_TOOL_REQUEST` | 建议一次工具调用 |
| `SUGGEST_PRESENTATION` | 建议一次呈现更新 |
| `CREATE_ARTIFACT` | 建议产出一份 artifact |
| `CONTROLLED_TEST` | 跑一次受控、被沙盒化的测试 |

**这些都只是建议或观察，不是动作。** 结果是被隔离的证据，不会直接修改状态。

## 输出 Firewall

外部请求的结果**不是动作**。它是被隔离的证据，要先过 **输出 firewall** 才能被 Runtime 采用。

Firewall 校验：

| 检查 | 干什么 |
| --- | --- |
| Schema | 结果是否匹配它声明的形状 |
| 来源 | 这条结果来自哪里 |
| Descriptor hash | principal 声明的能力是否还跟当前行为匹配 |
| 敏感度分类 | `USER_PRIVATE` / `CREDENTIAL_LIKE` / `ORG_PRIVATE` / `REGULATED` / `UNKNOWN_SENSITIVE` |
| Prompt poisoning | 这条结果是否被有意构造来操纵下游 |
| 流式 chunk 完整性 | 在完整信封被准入前隔离流式 chunk |

Firewall 是 **fail-close 准入**。任一项不过的，都不放行。

## Firewall 裁定

Firewall 发出以下之一：

| 裁定 | 含义 |
| --- | --- |
| `ACCEPTED_OBSERVATION` | Runtime 可以拿来当上下文用 |
| `ACCEPTED_SUGGESTION` | Runtime 自己决定下一步动作、求审批、还是无视 |
| `APPROVAL_REQUIRED` | 必须用户审批才能继续 |
| `QUARANTINED` | 留下不进一步使用 |
| `REJECTED` | 直接拒掉 |
| `PROVIDER_DRIFTED` | Descriptor hash 不匹配；session 隔离 |
| `SCHEMA_INVALID` | Schema 校验失败 |
| `POLICY_BLOCKED` | 信任 tier 或策略不允许 |

裁定对用户可见（在审批弹窗中），对审计 ledger 可见（在 lineage 记录里）。

## 动作的二次授权

被建议的工具调用**永不**直接执行。Runtime 二次授权后发出一个 Runtime 拥有的动作，带独立审计 lineage。

| 步骤 | 所有者 |
| --- | --- |
| 1. 外部 AI 提议（如 `SUGGEST_TOOL_REQUEST`） | 外部 AI |
| 2. 输出 firewall 校验 | Runtime |
| 3. 通过后 Runtime 出手 | Runtime |
| 4. 动作的审计 lineage 引用原始建议 | Runtime 审计 |

动作归 Runtime 拥有，不归外部 AI。来源是必填的；外部 AI 没法绕过去直接进数据面。

## 委派审批

当 firewall 裁定是 `APPROVAL_REQUIRED` 时，用户（或策略下准入的审批人）必须审批，动作才继续。审批作为证据记下来。

| 审批流 | Runtime |
| --- | --- |
| 审批请求 | 通过桌面端面向用户呈现 |
| 审批决定 | 记到 session 上 |
| 恢复 | Session 从 `PAUSED_FOR_APPROVAL` 恢复 |

## 委派 MCP 适配器

Runtime 把 MCP（Model Context Protocol）工具准入为一种特定的委派能力。MCP 适配器有自己的生命周期：

| 性质 | 值 |
| --- | --- |
| 工具发现 | 受 MCP 适配器合同约束 |
| 白名单 | 工具必须先白名单才能用 |
| Token 卫生 | 按 session 轮换 token |
| 闸口证据隔离 | 所有工具调用先按隔离证据处理 |

MCP 适配器**不允许**预 firewall 消费 — 每次工具调用都过输出 firewall。

## 委派 A2A（未来）

A2A（Agent-to-Agent）协议被准入为**未来接缝**。今天没有生产级 A2A 支持；接缝先准入，是为了防止 App / 桌面端 / Avatar / mod 用旁路捷径，将来跟真 A2A 撞车。

| 性质 | 值 |
| --- | --- |
| 生产支持 | 无 |
| 协议权威升格 | 禁止 |
| 旁路 | 禁止 |

## 审计与重放

每次委派请求、每条 firewall 裁定、每个动作、每个审批，都被记到 `K-AUDIT-*` 之上的委派审计 / 重放扩展。

| Lineage 元素 | 用途 |
| --- | --- |
| Suggestion id | 链回原始委派请求 |
| Firewall verdict | 记下 firewall 决定 |
| Approval decision | 记下用户 / 审批人决定 |
| Action lineage | 链到 Runtime 拥有的动作 |

重放可以重建整条链。没有静默捷径。

## 阅读场景：外部 AI 建议一次工具调用

1. **建议到达。** 外部 AI 发 `SUGGEST_TOOL_REQUEST`，带类型化工具 descriptor。
2. **Firewall 校验。** Schema、来源、descriptor hash、敏感度、prompt poisoning。
3. **裁定。** 敏感度是 `USER_PRIVATE`；信任 tier 是 `USER_ADDED_REVIEWED`；裁定 `APPROVAL_REQUIRED`。
4. **审批弹窗。** 桌面端面向用户呈现审批请求。
5. **用户同意。** 审批被记下。
6. **Runtime 动手。** Runtime 在自己的审计 lineage 下执行类型化工具动作。
7. **审计链。** Lineage 串起 suggestion → verdict → approval → action。

外部 AI 没有直接按下工具。Runtime 替用户按下了。

## 阅读场景：Provider 漂移导致 Session 被隔离

1. **Session 在线。** 外部 AI 处于 `OPEN`。
2. **Session 中途 descriptor 变了。** Provider 工具 descriptor hash 跟 session 打开时不一样。
3. **Firewall 检测漂移。** 裁定 `PROVIDER_DRIFTED`。
4. **Provider 生命周期。** Provider 状态搬到 `QUARANTINED`。
5. **Session 进入 `PAUSED_FOR_APPROVAL` 或 `CLOSING`**，由策略决定。
6. **用户看到原因。** "Provider X 的 descriptor 在 session 中变了。"
7. **没有静默继续。** 平台不会假装漂移没发生。

## 来源

- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-approval-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-approval-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-a2a-future-seam-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-a2a-future-seam-contract.md)
- [`.nimi/spec/runtime/kernel/tables/delegation-provider-profiles.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-provider-profiles.yaml)
- [`.nimi/spec/runtime/kernel/tables/delegation-request-fields.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-request-fields.yaml)
- [`.nimi/spec/runtime/kernel/tables/delegation-result-fields.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-result-fields.yaml)
- [`.nimi/spec/runtime/kernel/tables/delegation-reason-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-reason-codes.yaml)
- [`.nimi/spec/runtime/kernel/tables/delegation-protocol-adapters.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-protocol-adapters.yaml)
- [`.nimi/spec/platform/ai-last-mile.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-last-mile.md)
- [`.nimi/spec/platform/ai-agent-security-interface.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-agent-security-interface.md)
