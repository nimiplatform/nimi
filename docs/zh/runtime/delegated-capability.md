# 受委派能力

## 状态：现在 (Running today)

Runtime 受委派会话、网关、输出防火墙以及审计 / 重放扩展均在 K-DELEG-* 下交付；MCP 适配器以 stdio_command 交付，远程传输作为方向准入。

外部 AI 宿主（另一家 AI provider、配 MCP 工具的 Agent、未来的 A2A 对端）想在平台上动作时，要通过 Runtime 持有的网关与输出防火墙。本页讲委派的 Runtime 这一面。产品角度的说明见 [平台 → AI 最终执行环节](/zh/platform/ai-last-mile) 与 [平台 → Agents → 外部 Agent](/zh/platform/agents/external-agents)。

## 受委派会话

外部 AI 想动作时，Runtime 给它开一条**受委派会话**。会话有强类型身份、信任层级、一份冻结的策略快照和一条明确的生命周期。

| 属性 | 取值 |
| --- | --- |
| 身份 | 强类型外部 principal id |
| 信任层级 | `CONTROLLED_LOCAL` / `USER_ADDED_REVIEWED` / `ORG_MANAGED` / `BLOCKED` |
| 策略快照 | 会话开启时冻结 |
| 生命周期 | `OPEN → PAUSED_FOR_APPROVAL → CLOSING → CLOSED|FAILED` |

信任层级决定策略快照。审批要求、敏感度阈值、隔离触发条件都按信任层级来读。

## Provider 生命周期

外部 provider 的生命周期在 runtime 层面准入：

| 状态 | 含义 |
| --- | --- |
| `REGISTERED` | provider 进入系统 |
| `DISCOVERING` | 能力发现进行中 |
| `READY` | provider 健康可达 |
| `DEGRADED` | provider 可达但可靠性下降 |
| `DISABLED` | provider 已禁用 |
| `QUARANTINED` | 因漂移或策略违规进入隔离 |
| `REMOVED` | provider 已移除 |

provider 在会话中漂移（描述符哈希变了）会自动转入 `QUARANTINED`。漂移之后不会静默继续。

## 强类型委派请求

外部 AI 发出的委派请求是强类型的：

| 请求 | 用途 |
| --- | --- |
| `OBSERVE` | 报告一次观察 |
| `QUERY` | 提出强类型问题 |
| `SUGGEST_INTENT` | 建议某个意图 |
| `SUGGEST_TOOL_REQUEST` | 建议某次工具调用 |
| `SUGGEST_PRESENTATION` | 建议呈现更新 |
| `CREATE_ARTIFACT` | 建议产出某个产物 |
| `CONTROLLED_TEST` | 在受控沙箱中跑测试 |

这些**只是建议或观察，不是动作**。结果先入隔离区做证据，不直接改状态。

## 输出防火墙

外部请求的结果**不是动作**，而是隔离的证据，必须先过**输出防火墙**，Runtime 才能基于它行动。

防火墙校验：

| 检查 | 内容 |
| --- | --- |
| Schema | 结果是否符合声明形态 |
| 来源 | 结果出自何处 |
| 描述符哈希 | principal 声明的能力是否与当前行为一致 |
| 敏感度归类 | `USER_PRIVATE` / `CREDENTIAL_LIKE` / `ORG_PRIVATE` / `REGULATED` / `UNKNOWN_SENSITIVE` |
| Prompt 投毒 | 结果是否在试图操纵下游行为 |
| 流式分片完整性 | 整封信封被准入前，所有分片先入隔离 |

防火墙是**fail-closed 的准入**。任何一项不通过，都不放行。

## 防火墙裁决

防火墙输出下面之一：

| 裁决 | 含义 |
| --- | --- |
| `ACCEPTED_OBSERVATION` | Runtime 可作为上下文使用 |
| `ACCEPTED_SUGGESTION` | Runtime 自行决定动作、通过审批或忽略 |
| `APPROVAL_REQUIRED` | 必须经用户审批才能继续 |
| `QUARANTINED` | 留在隔离区不再使用 |
| `REJECTED` | 直接拒收 |
| `PROVIDER_DRIFTED` | 描述符哈希与预期不一致，会话进入隔离 |
| `SCHEMA_INVALID` | schema 校验失败 |
| `POLICY_BLOCKED` | 信任层级或策略不允许 |

裁决对用户可见（出现在审批卡上），对审计账本也可见（在链路记录里）。

## 动作的二次授权

被建议的工具调用**永远**不会直接执行。Runtime 要做一次二次授权，再发出由 Runtime 持有、带独立审计链路的动作。

| 步骤 | 持有方 |
| --- | --- |
| 1. 外部 AI 提议（如 `SUGGEST_TOOL_REQUEST`） | 外部 AI |
| 2. 输出防火墙校验 | Runtime |
| 3. 通过后 Runtime 行动 | Runtime |
| 4. 动作的审计链路回连原建议 | Runtime 审计 |

动作归 Runtime 持有，不归外部 AI。来源是必填项，外部 AI 无法绕进数据面。

## 委派审批

防火墙裁决为 `APPROVAL_REQUIRED` 时，要由用户（或策略允许的审批人）批准之后动作才能继续。审批本身记成证据。

| 审批流程 | Runtime |
| --- | --- |
| 审批请求 | 经桌面端呈现给用户 |
| 审批决定 | 计入会话 |
| 恢复 | 会话从 `PAUSED_FOR_APPROVAL` 恢复 |

## 受委派 MCP 适配器

Runtime 把 MCP（Model Context Protocol）工具准入为一类受委派能力。MCP 适配器有自己的生命周期：

| 属性 | 取值 |
| --- | --- |
| 工具发现 | 受 MCP 适配器契约约束 |
| 白名单 | 工具必须先入白名单才能用 |
| Token 卫生 | 每会话 token 轮换 |
| 隔离的网关证据 | 每次工具调用先按隔离证据处理 |

MCP 适配器**不允许**绕过防火墙消费——每一次工具调用都过输出防火墙。

## 受委派 A2A（未来）

A2A（Agent-to-Agent）协议被准入为**未来用接缝**。当前不存在生产级 A2A 支持。准入这条接缝，是为了挡住应用 / 桌面端 / Avatar / mod 的旁路捷径，不让它们以后和真正的 A2A 撞车。

| 属性 | 取值 |
| --- | --- |
| 生产支持 | 无 |
| 协议权威升格 | 禁止 |
| 旁路路径 | 禁止 |

## 审计与回放

每一次委派请求、每一条防火墙裁决、每一次动作、每一次审批，都按 `K-AUDIT-*` 存储之上的委派审计 / 回放扩展记录。

| 链路元素 | 用途 |
| --- | --- |
| Suggestion id | 回连原始委派请求 |
| 防火墙裁决 | 记下防火墙的判定 |
| 审批决定 | 记下用户 / 审批人的决定 |
| 动作链路 | 回连 Runtime 持有的动作 |

回放可以重建整条链。没有静默捷径。

## 读者场景：外部 AI 建议一次工具调用

1. **建议到达。** 外部 AI 发来 `SUGGEST_TOOL_REQUEST`，附强类型工具描述符。
2. **防火墙校验。** schema、来源、描述符哈希、敏感度、prompt 投毒一一核对。
3. **裁决。** 敏感度是 `USER_PRIVATE`，信任层级是 `USER_ADDED_REVIEWED`，裁决是 `APPROVAL_REQUIRED`。
4. **审批弹窗。** 桌面端把审批卡呈现给用户。
5. **用户同意。** 审批被记下。
6. **Runtime 执行。** Runtime 在自己的审计链路下执行这条强类型工具动作。
7. **审计链。** 链路串起：建议 → 裁决 → 审批 → 动作。

外部 AI 没有直接按下工具按钮，是 Runtime 代用户做的。

## 读者场景：provider 漂移让会话进入隔离

1. **会话活跃。** 外部 AI 处于 `OPEN`。
2. **会话中途，描述符变了。** provider 工具描述符哈希和会话开启时不一致。
3. **防火墙发现漂移。** 裁决：`PROVIDER_DRIFTED`。
4. **provider 生命周期。** provider 状态切到 `QUARANTINED`。
5. **会话按策略转入 `PAUSED_FOR_APPROVAL` 或 `CLOSING`。**
6. **用户看到原因。** "provider X 在会话中途改了描述符"。
7. **不静默继续。** 平台不会假装漂移没发生。

## 来源依据

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
