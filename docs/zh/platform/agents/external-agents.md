# 外部 Agent

Nimi 把外部 AI 宿主——独立的 AI Provider、带 MCP 工具的 Agent、以及未来的 A2A peer——当成一等参与者。它们注册为 `ExternalPrincipal`，持有限定作用域的 Token，并通过与内部 Agent 相同的 Hook Action Fabric 行动。

本页面是产品叙述。安全与授权框架见[权威模型](/zh/platform/authority-model)与 [AI 最终执行环节](/zh/platform/ai-last-mile)。

## `ExternalPrincipal` 是什么

`ExternalPrincipal` 是平台为外部 AI 宿主准入的强类型身份。它与用户、Agent、应用 principal 一同被认定为授权模型里真实存在的参与者。

| 维度 | 取值 |
| --- | --- |
| 签发入口 | 桌面端外部 Agent 接入面板 |
| Token 形态 | 限定作用域，明文一次性展示 |
| 签发后可见性 | 只通过不可变账本 |
| 能力域 | `action.discover.*`、`action.dry-run.*`、`action.verify.*`、`action.commit.*` |
| 信任层级 | `CONTROLLED_LOCAL` / `USER_ADDED_REVIEWED` / `ORG_MANAGED` / `BLOCKED` |
| 动作面 | Hook Action Fabric（Runtime + 桌面端 hook 能力沙箱） |

明文一次性展示是有意为之。Token 在签发时显示一次；之后只能通过账本看到元数据。这意味着即便重新打开签发页面，也不会再次暴露明文。

## 能力域

Token 的作用域由能力域定义。每个能力域准入它自己的强类型动词。

| 能力域 | 覆盖范围 |
| --- | --- |
| `action.discover.*` | 只读发现——什么可用、什么可达 |
| `action.dry-run.*` | 不提交的模拟——会发生什么 |
| `action.verify.*` | 不修改地确认某个值或条件 |
| `action.commit.*` | 修改状态——真正执行动作 |

Token 可以携带任意子集。一个只读助手可能拿 `discover` + `dry-run`；一个更强的集成可能在特定作用域上拿 `commit`。平台拒绝"无所不能"的环境型 Token，作用域始终显式。

## 信任层级

每个外部 principal 都在某个信任层级下准入：

| 层级 | 含义 |
| --- | --- |
| `CONTROLLED_LOCAL` | 限制最严；行为仅在本地，作用域很小 |
| `USER_ADDED_REVIEWED` | 用户主动选择；典型宿主的默认值 |
| `ORG_MANAGED` | 组织按策略准入了这个 principal |
| `BLOCKED` | 显式拒绝；无法注册 |

信任层级影响该 principal 委派会话上的策略快照：审批要求、敏感度阈值、隔离触发条件，都从信任层级读取。

## 委派会话

外部 principal 想要行动时，Runtime 给它打开一次**委派会话**。

| 维度 | 取值 |
| --- | --- |
| 身份 | 强类型外部 principal id |
| 信任层级 | 来自注册时 |
| 策略快照 | 在会话打开时冻结 |
| 生命周期 | `OPEN → PAUSED_FOR_APPROVAL → CLOSING → CLOSED|FAILED` |

会话内，外部 principal 发出强类型委派请求：

| 请求 | 用途 |
| --- | --- |
| `OBSERVE` | 报告一个观察 |
| `QUERY` | 提出强类型问题 |
| `SUGGEST_INTENT` | 提议一个意图 |
| `SUGGEST_TOOL_REQUEST` | 提议一次工具调用 |
| `SUGGEST_PRESENTATION` | 提议呈现更新 |
| `CREATE_ARTIFACT` | 提议创建产物 |
| `CONTROLLED_TEST` | 在受控沙箱中测试 |

注意：**这些都是建议或观察，不是动作**。外部请求的结果是隔离区里的证据，不是直接的状态修改。

## 输出防火墙

每一份来自外部 principal 的结果在 Runtime 行动前都要经过输出防火墙。

防火墙校验：

- **Schema** —— 结果是否匹配声明的形态？
- **Provenance** —— 结果来自哪里？
- **描述符哈希** —— principal 声明的能力是否与当前行为一致，有没有漂移？
- **敏感度分类** —— `USER_PRIVATE` / `CREDENTIAL_LIKE` / `ORG_PRIVATE` / `REGULATED` / `UNKNOWN_SENSITIVE`。
- **Prompt 投毒检测** —— 结果是否被构造来操控下游行为？

防火墙吐出其中一种裁决：

| 裁决 | 含义 |
| --- | --- |
| `ACCEPTED_OBSERVATION` | Runtime 可以把它当作上下文使用 |
| `ACCEPTED_SUGGESTION` | Runtime 决定行动、走审批，还是忽略 |
| `APPROVAL_REQUIRED` | 必须经过用户审批 |
| `QUARANTINED` | 留置，不再使用 |
| `REJECTED` | 直接拒收 |
| `PROVIDER_DRIFTED` | 描述符哈希与预期不一致；会话隔离 |
| `SCHEMA_INVALID` | Schema 校验失败 |
| `POLICY_BLOCKED` | 信任层级或策略阻断 |

外部 AI 提议的工具调用**永远不会**直接执行。Runtime 重新授权，并以独立审计血缘发出由 Runtime 拥有的动作。

## 场景：添加一个外部 AI 宿主

用户想给某个外部 AI 宿主授予对自己 Nimi 账户的有界访问。

1. **打开外部 Agent 接入面板**。这是签发外部 principal Token 的唯一入口。
2. **选择能力域**。用户挑了 `action.discover.contacts`、`action.dry-run.message_compose`，把消息相关的 `action.commit.*` 排除掉。
3. **签发**。面板签发限定作用域的 Token，明文展示一次。用户复制 Token 到外部 AI 宿主的配置里。
4. **账本**。后续可见性只通过不可变账本。用户可以随时撤销，撤销会被记录。
5. **外部 AI 已注册为 principal**。它在自己的作用域内行动。

注意：用户没有把信用卡号粘贴给外部 AI。这条 Token 不授权钱包操作——因为用户没有把 `action.commit.gift` 或任何钱包域加进去。

## 场景：外部 AI 的建议被隔离

外部 AI 发了一个 `SUGGEST_TOOL_REQUEST`，要调用一个操作凭证的工具。

1. **输出防火墙分类**。敏感度：`CREDENTIAL_LIKE`。
2. **裁决**。信任层级与策略快照规定，这类敏感结果必须隔离。
3. **隔离**。结果被留置；Runtime 不当作上下文用，不传给用户，不行动。
4. **审计**。隔离记入审计，附原因与血缘。

外部 AI 没有绕路。防火墙横在它与任何平台动作之间。

## 场景：Provider 漂移触发隔离

外部 AI 的描述符哈希在会话中途变了——可能是底层 Provider 更新了工具描述符。

1. **防火墙发现不一致**。会话当初登记的描述符与现在报告的不一致。
2. **`PROVIDER_DRIFTED` 裁决**。会话进入 `PAUSED_FOR_APPROVAL`，按策略可能走向 `CLOSED|FAILED`。
3. **用户看到原因**："外部 AI 的描述符在会话中变了，你可以重新准入或撤销。"
4. **不会静默继续**。平台不会假装漂移没发生。

这也是为什么外部 AI 集成是真实产品特性，而不是集成风险。漂移会被检测并显式呈现。

## Source Basis

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
