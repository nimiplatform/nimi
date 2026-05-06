# 外部 Agent

Nimi 里的外部 AI 宿主，包括独立 AI Provider、有 MCP 工具的 Agent、未来的 A2A peer，都是一等参与者。它们注册成 `ExternalPrincipal`，持 scoped token，并使用与内部 Agent 相同的 Hook Action Fabric 行动。

本页是产品叙述。安全和授权框架见 [权威模型](/zh/platform/authority-model) 和 [AI 最后一公里](/zh/platform/ai-last-mile)。

## `ExternalPrincipal` 是什么

`ExternalPrincipal` 是平台给外部 AI 宿主的类型化身份。它跟用户、Agent、App 一样，作为授权模型里的真实参与者被准入。

| 属性 | 值 |
| --- | --- |
| 签发途径 | 桌面端的 External Agent Access 面板 |
| Token 形状 | Scoped，单次明文显示 |
| 签发后 token 可见性 | 只在 immutable 的 token ledger 里 |
| 能力域 | `action.discover.*`、`action.dry-run.*`、`action.verify.*`、`action.commit.*` |
| 信任层级 | `CONTROLLED_LOCAL` / `USER_ADDED_REVIEWED` / `ORG_MANAGED` / `BLOCKED` |
| 行动面 | Hook Action Fabric（Runtime + 桌面端 Hook 能力沙箱） |

单次明文显示是有意的。token 在签发时显示一次；之后的可见性走 ledger。这意味着 token 不会因为重新渲染签发页而被悄悄暴露。

## 能力域

token 的 scope 由能力域定义。每个域准入自己的类型化动词。

| 域 | 涵盖什么 |
| --- | --- |
| `action.discover.*` | 只读发现 — 有什么可用、能到达什么 |
| `action.dry-run.*` | 不提交地模拟一次动作 — 看会发生什么 |
| `action.verify.*` | 不修改地确认某个值或条件 |
| `action.commit.*` | 修改状态 — 真正执行动作 |

token 可以带任意子集。一个只读助手可能有 `discover` + `dry-run`。一个更强的集成可能在特定 scope 上有 `commit`。平台拒绝"任意行动"的环境 token；scope 永远是显式的。

## 信任层级

每个外部 principal 在某个信任层级下被准入：

| 层级 | 含义 |
| --- | --- |
| `CONTROLLED_LOCAL` | 限制最严；行为本地、scope 紧 |
| `USER_ADDED_REVIEWED` | 用户显式选了这个 principal；典型宿主默认 |
| `ORG_MANAGED` | 组织在自己策略下准入了它 |
| `BLOCKED` | 显式拒绝；不能注册 |

信任层级塑形 principal 委派会话上的策略快照。批准要求、敏感度阈值、隔离触发都从信任层级读。

## 委派会话

外部 principal 想行动时，Runtime 给它开**委派会话**。

| 属性 | 值 |
| --- | --- |
| 身份 | 类型化外部 principal id |
| 信任层级 | 来自注册 |
| 策略快照 | 会话开启时冻结 |
| 生命周期 | `OPEN → PAUSED_FOR_APPROVAL → CLOSING → CLOSED|FAILED` |

会话内，外部 principal 发类型化委派请求：

| 请求 | 用途 |
| --- | --- |
| `OBSERVE` | 上报一个观察 |
| `QUERY` | 提一个类型化的问题 |
| `SUGGEST_INTENT` | 提议一个 intent |
| `SUGGEST_TOOL_REQUEST` | 提议一次工具调用 |
| `SUGGEST_PRESENTATION` | 提议呈现更新 |
| `CREATE_ARTIFACT` | 提议创建一个产物 |
| `CONTROLLED_TEST` | 跑一次受控的、沙箱化的测试 |

注意**这些都是建议或观察，不是动作**。外部请求的结果是被隔离的证据，不是修改。

## 输出防火墙

外部 principal 的每一个结果在 Runtime 据此行动之前，都先过输出防火墙。

防火墙校验：

- **Schema** — 结果是不是符合声明的形状？
- **来源** — 这个结果是从哪来的？
- **Descriptor hash** — principal 声明的能力是不是匹配它当前的行为，还是漂移了？
- **敏感度分类** — `USER_PRIVATE` / `CREDENTIAL_LIKE` / `ORG_PRIVATE` / `REGULATED` / `UNKNOWN_SENSITIVE`。
- **Prompt poisoning 检测** — 结果是不是被设计来操纵下游行为？

防火墙发出之一：

| 裁决 | 含义 |
| --- | --- |
| `ACCEPTED_OBSERVATION` | Runtime 可以拿来当上下文 |
| `ACCEPTED_SUGGESTION` | Runtime 决定要执行、要批准、还是忽略 |
| `APPROVAL_REQUIRED` | 必须经用户批准 |
| `QUARANTINED` | 隔离，不再使用 |
| `REJECTED` | 直接拒 |
| `PROVIDER_DRIFTED` | descriptor hash 跟期待不一致；会话隔离 |
| `SCHEMA_INVALID` | schema 校验失败 |
| `POLICY_BLOCKED` | 信任层级或策略阻止 |

被建议的工具调用**绝不**直接执行。Runtime 重新授权，发出由 Runtime 拥有的动作，带独立的审计 lineage。

## 阅读场景：加一个外部 AI 宿主

用户想给一个外部 AI 宿主有界访问 Nimi 账号的权限。

1. **打开 External Agent Access 面板**。这是外部 principal token 的唯一签发处。
2. **选能力域**。用户选 `action.discover.contacts`、`action.dry-run.message_compose`，**排除**消息相关的 `action.commit.*`。
3. **签发**。面板签发一个 scoped token，单次明文显示。用户把 token 复制到外部 AI 宿主的配置里。
4. **Ledger**。后续可见性走 immutable token ledger。用户随时可以撤销；撤销被记录。
5. **外部 AI 现在是注册的 principal**。它在自己 scope 里行动。

注意：用户没有把信用卡号粘到外部 AI 里。token 不授权钱包操作，因为用户没勾 `action.commit.gift` 或任何钱包域。

## 阅读场景：外部 AI 的建议被隔离

一个外部 AI 发了一个 `SUGGEST_TOOL_REQUEST`，要调用一个会接触凭据的工具。

1. **输出防火墙分类**结果。敏感度：`CREDENTIAL_LIKE`。
2. **裁决**。信任层级和策略快照说，来自这个 principal 的凭据类结果必须隔离。
3. **隔离**。结果被持有；Runtime 不当上下文用，不传给用户，不据此行动。
4. **审计**。隔离带原因和 lineage 被记录。

外部 AI 没法绕过这个。防火墙在外部 principal 和任何平台动作之间。

## 阅读场景：Provider 漂移触发隔离

外部 AI 的 descriptor hash 在会话中途变了 — 也许底层 Provider 更新了工具 descriptor。

1. **防火墙检测到不匹配**。会话声明的 descriptor 跟现在报的对不上。
2. **`PROVIDER_DRIFTED` 裁决**。会话进 `PAUSED_FOR_APPROVAL` 或按策略走向 `CLOSED|FAILED`。
3. **用户看到原因**。"外部 AI 的 descriptor 在会话中途变了；你可以重新准入或撤销。"
4. **不会无声继续**。平台不会装作漂移没发生过。

这就是把外部 AI 集成做成真正产品功能、而不是集成风险的关键。漂移会被检测、显式上报。

## 来源

- [`.nimi/spec/platform/ai-agent-security-interface.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-agent-security-interface.md)
- [`.nimi/spec/platform/ai-last-mile.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-last-mile.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-approval-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-approval-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-a2a-future-seam-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-a2a-future-seam-contract.md)
- [`.nimi/spec/runtime/kernel/tables/delegation-provider-profiles.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-provider-profiles.yaml)
- [`.nimi/spec/runtime/kernel/tables/delegation-request-fields.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-request-fields.yaml)
- [`.nimi/spec/runtime/kernel/tables/delegation-result-fields.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-result-fields.yaml)
- [`.nimi/spec/desktop/external-agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/external-agent.md)
