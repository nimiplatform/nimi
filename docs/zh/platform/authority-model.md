# 权威模型

Nimi 的权威模型让差异极大的参与者共享同一个平台：终端用户、世界创作者、Mod 开发者、应用开发者、AI Agent、外部 AI 宿主都在其中，但其中任何一个都不能悄悄盖过另一个。本页用产品语言解释这个模型。

模式级定义见 [Reference → Authority Domains](/zh/reference/authority-domains)。

## 模型回答的三个问题

任何跨参与者平台都要回答这三个问题：

1. **谁在动作？** 主体（principal）模型。
2. **他们被允许做什么？** 授权预设和 scope。
3. **是哪类应用在做这件事？** 应用模式 — 仅渲染 vs 完整扩展。

## Principal（主体）

一个 principal 是任何动作背后的实体。Nimi 把它们显式命名出来，授权才不会有歧义。

| Principal | 代表什么 |
| --- | --- |
| User | 一个真人，有账号、身份、社交图、钱包。 |
| Agent | 一等的自主参与者；不是工具，不是会话。 |
| App | 代表用户运行的代码（仅渲染或扩展）。 |
| External Principal | 被授予 scoped 能力域的外部 AI 宿主（委派 AI）。 |

每一次动作都把 principal 的身份带进审计 lineage。这就是"外部 AI 做了这件事" vs "用户做了这件事" vs "Agent 做了这件事"被区分开的关键。

## 授权预设

App 和外部 principal 拿不到自由形式的能力清单。平台准入了一小组预设模板，它们共享同样的 token 形状和验证链。

| 预设 | 读 | 写 | 委派 |
| --- | --- | --- | --- |
| `readOnly` | 是 | 否 | 否 |
| `full` | 是 | 是 | 否 |
| `delegate` | 是 | 是 | 默认一层 |

`delegate` 预设默认允许最多再委派一层 — 这是有意的。多跳委派链会破坏审计可追溯性，平台默认拒绝它。

## App 模式

一个 App 声明自己是哪类公民。模式决定 App 能写什么、以及一个世界里能同时活几个这样的 App。

| 模式 | 读世界数据 | 写世界数据 | 一个世界里并存数 |
| --- | --- | --- | --- |
| `render-app` | 是 | 否 | 多个 |
| `extension-app` | 是 | 是 | 同时最多一个 active |

一个世界在任何时刻最多有一个 active 的 `extension-app` binding。重新绑定需要先显式吊销 — 平台**不会**悄悄转移写权威。

## App-世界绑定生命周期

```
(new) → active → suspended → revoked
              ↑     ↓
              └─────┘
```

- 一个世界初始没有 active App binding。
- 一个被准入的 extension-app 可以进入 `active`。
- active binding 可以被 `suspended`（暂停，可恢复）或 `revoked`（移除；另一个 App 可以绑定了）。
- 暂停可逆；吊销不可逆。

## External Principal（外部主体）

平台把外部 AI 宿主（独立的 AI Provider、有 MCP 工具的 Agent、未来的 A2A peer）作为 `ExternalPrincipal` 实体准入。它们在授权模型里是一等参与者 — 不是事后追加的集成。

| 属性 | 值 |
| --- | --- |
| Token 形状 | Scoped，单次明文显示 |
| 签发后 token 可见性 | 只在 immutable 的 token ledger 里 |
| 能力域 | `action.discover.*`、`action.dry-run.*`、`action.verify.*`、`action.commit.*` |
| 签发 UI | 桌面端的 External Agent Access 面板 |

scoped token **不**授予任意动作。每个能力域都有自己已认可的操作。一个外部 AI 不能送礼物，除非 token 带 `action.commit.gift`（或同等已认可能力）。

## 阅读场景：App 作者挑选合适的模式

你在写一个新 App。它要读世界状态、把它显示得好看，让用户写聊天消息。

- 你不需要写世界真相。世界状态变更不是你 App 的事。
- 你能跟其他 App 一起跑 — 你的 App 不应该挡住其他 extension-app 的绑定。

这正是 `render-app` 的画像。你通过 `sdk/world` 和 `sdk/realm` 读世界数据；聊天编写走聊天 API，你的 App 不需要在世界真相上拥有写权威。

如果以后你加了一个会改变世界规则的特性，就需要切到 `extension-app` 模式并绑定到世界。一个世界同时只能有一个 active 的 extension-app — 你要么需要专属性准入，要么这个特性应该放别的地方。

## 阅读场景：用户给外部 AI 授有限访问权

你想让一个外部 AI 宿主能读你的联系人、给出回复建议 — 但不能不经你同意发消息，也根本不能碰你的钱包。

1. 你打开桌面端的 External Agent Access 面板。
2. 你勾选能力域：`action.discover.contacts`、`action.dry-run.message_compose`。你**排除** `action.commit.*` 这一类消息能力，并排除所有钱包相关域。
3. 面板签发一个 scoped token，单次明文显示。
4. 你把 token 给你的外部 AI。从此以后，token ledger 显示这次签发、active scope、以及你做过的撤销。平台**不会**再次显示 token 明文。
5. 外部 AI 提出 scope 之外的操作，会在输出防火墙里 fail-closed — `POLICY_BLOCKED` 或 `REJECTED`。
6. scope 之内但属于敏感类的操作仍然要你批准 — 批准本身被记进审计 ledger 作为证据。

权威模型让这件事是安全的。token 不是自由形式的钥匙；scope 是被准入的；防火墙在执行；审计在记录。

## 为什么是这个形状

| 关注 | 这个设计如何回应 |
| --- | --- |
| AI Agent 是一等的 | principal 模型把 agent 和 external-principal 当作真实参与者，不是用户的快捷方式。 |
| App 必须可替换 | App 模式不是特权层级；桌面端是一个 extension-app 同侪。 |
| 外部 AI 必须安全 | scoped token + ledger + 防火墙 + 批准是端到端的链，不是单一守门员。 |
| 审计必须能重建 | 每个动作都带 principal lineage；token 不可重新显示来伪造来源。 |
| 世界所有权必须明确 | 一个世界同时最多一个 active 的 extension-app；绑定是显式的。 |

## 来源

- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml)
- [`.nimi/spec/platform/kernel/tables/participant-profiles.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/participant-profiles.yaml)
- [`.nimi/spec/platform/ai-agent-security-interface.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-agent-security-interface.md)
- [`.nimi/spec/runtime/kernel/scoped-app-binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scoped-app-binding-contract.md)
- [`.nimi/spec/runtime/kernel/auth-service.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/auth-service.md)
- [`.nimi/spec/runtime/kernel/account-session-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/account-session-contract.md)
- [`.nimi/spec/realm/kernel/binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/binding-contract.md)
