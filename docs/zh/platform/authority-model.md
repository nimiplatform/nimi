# 权威模型

Nimi 的权威模型让差异巨大的参与者——终端用户、世界创作者、App 开发者、AI Agent、外部 AI 宿主——共享同一个平台，且互不悄悄覆盖。本页从产品角度解释这一模型。

如需 schema 级定义，参见 [Reference → Authority Domains](/reference/authority-domains)。

## 模型回答的三个问题

任何多方共存的平台都得回答这三件事，权威模型也是如此：

1. **谁在动手**：principal 模型。
2. **它能做什么**：授权预设与作用域。
3. **是哪一类 App**：App 模式——只读渲染还是可写扩展。

## Principal

Principal 是动作背后的主体。Nimi 给它显式命名，让授权不再含糊。

| Principal | 代表什么 |
| --- | --- |
| User | 真实的人，有账户、身份、社交图、钱包。 |
| Agent | 一等的自主参与者，不是工具，也不是会话。 |
| App | 代表用户运行的代码（只读渲染或扩展）。 |
| External Principal | 外部 AI 宿主（受委派 AI），获得作用域内的能力域。 |

每次动作都在审计血缘里带着 principal 身份。"外部 AI 做了这件事"、"用户做了这件事"、"Agent 做了这件事"由此被区分。

## 授权预设

App 与外部 principal 不会拿到自由格式的能力清单。平台准入了一组小预设模板，共享同样的 token 形态与校验链。

| 预设 | 读 | 写 | 委派 |
| --- | --- | --- | --- |
| `readOnly` | 是 | 否 | 否 |
| `full` | 是 | 是 | 否 |
| `delegate` | 是 | 是 | 默认一层 |

`delegate` 预设默认只允许再向下一层委派——这是刻意的。多跳委派会破坏审计追溯，平台默认不接受。

## App 模式

App 在声明时就要表明自己是哪一类公民。模式决定 App 能写什么，以及一个世界里能同时活着多少个这样的 App。

| 模式 | 读世界数据 | 写世界数据 | 每个世界并发数 |
| --- | --- | --- | --- |
| `render-app` | 是 | 否 | 多 |
| `extension-app` | 是 | 是 | 同时最多一个激活 |

每个世界在任意时刻最多只有一个激活的 `extension-app` 绑定。换绑必须先显式撤销，平台不会悄悄转移写权威。

## App 与世界的绑定生命周期

```
(new) → active → suspended → revoked
              ↑     ↓
              └─────┘
```

- 世界初始没有任何 App 绑定。
- 一个准入的 extension-app 可以进入 `active`。
- 激活态的绑定可以 `suspended`（暂停，可恢复）或 `revoked`（撤销，移除后另一个 App 可绑定）。
- 暂停可逆，撤销不可逆。

## 外部 Principal

平台把外部 AI 宿主（另一家 AI 提供者、装了 MCP 工具的 Agent、未来的 A2A peer）准入为 `ExternalPrincipal` 实体。它们是授权模型里的一等参与者，不是事后补丁式的集成。

| 属性 | 值 |
| --- | --- |
| Token 形态 | 带作用域，明文一次性展示 |
| 颁发后可见性 | 只在不可变 token 账本中可见 |
| 能力域 | `action.discover.*`、`action.dry-run.*`、`action.verify.*`、`action.commit.*` |
| 颁发界面 | 桌面端的 External Agent Access 面板 |

带作用域的 token 不是任意动作的通行证。每个能力域有自己准入的操作集合。如果 token 没有 `action.commit.gift`（或等价的准入能力），外部 AI 就送不出礼物。

## 场景：App 作者选模式

你在写一个新 App。它需要读世界状态、把它呈现得好看、让用户编辑聊天消息。

- 你不需要写世界真相，世界状态变更不属于这个 App。
- 你能与其它 App 并存，不应该挡住别的 extension-app 绑定。

这正是 `render-app` 的画像。你通过 `@nimiplatform/sdk/realm` 或 root-client Realm composition 读世界数据，聊天编写走已准入的聊天 API，App 不需要成为世界真相的写权威。

如果以后你加了一个会改世界规则的功能，就要切到 `extension-app` 模式并绑定到世界。每个世界仅一个激活 extension-app，你要么走专属准入，要么把这个功能放到别处。

## 场景：用户给外部 AI 受限访问

你希望外部 AI 宿主能读你的联系人、给你建议回复，但不希望它在你不同意时直接发消息，也不希望它接触你的钱包。

1. 你在桌面端打开 External Agent Access 面板。
2. 选择能力域：`action.discover.contacts`、`action.dry-run.message_compose`。把消息的 `action.commit.*` 排除，把所有钱包域排除。
3. 面板颁发一个带作用域的 token，明文一次性展示。
4. 你把 token 给外部 AI。从这一刻起，token 账本会记录颁发、当前作用域、以及你做的任何撤销。平台不会再把 token 明文展示出来。
5. 外部 AI 提议任何超出作用域的事，输出防火墙会 fail-closed——`POLICY_BLOCKED` 或 `REJECTED`。
6. 它在作用域内但属于敏感类的提议仍要你审批，并以证据形式记入审计账本。

权威模型让这件事变得安全。Token 不是自由格式钥匙；作用域是准入的；防火墙负责执行；审计账本负责记录。

## 这套模型为什么这样设计

| 关注点 | 这套设计如何回应 |
| --- | --- |
| AI Agent 是一等公民 | principal 模型把 Agent 与外部 principal 当作真实参与者，不是用户的快捷方式 |
| App 必须可被替换 | App 模式不是特权层级，桌面端只是一个 extension-app 同侪 |
| 外部 AI 必须安全 | 带作用域 token、账本、防火墙、审批是端到端的链路，不是单一闸口 |
| 审计必须可还原 | 每次动作都带 principal 血缘；token 不会重复展示，伪造来源走不通 |
| 世界归属必须无歧义 | 每个世界最多一个激活 extension-app，绑定显式 |

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
