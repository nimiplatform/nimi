# 外部 Agent 接入

外部 Agent 接入面板是桌面端用来管理 `ExternalPrincipal` token 的独有 UI。它是「让外部 AI 宿主以受控、有范围、可撤销的方式访问我的 Nimi 账号」的人面。

平台级模型见 [Platform → Agents → 外部 Agent](/zh/platform/agents/external-agents)。

## 面板做什么

| 步骤 | 行为 |
| --- | --- |
| 读闸口状态 | 显示当前外部 Agent 闸口状态 |
| 配置 | 选择 principal id / 账号 / 模式 / 动作 / TTL |
| 颁发 token | 提交；runtime 颁发有范围的 token |
| 明文显示 | 颁发出的 token 一次性明文显示 |
| Token ledger | 之后只能通过不可变 ledger 看 |
| 撤销 / 列表 | 在 ledger 上操作（撤销、看活跃 token） |

面板是**这些 token 唯一被颁发或显示明文的地方**。颁发后 token 不再可见 — 只有 ledger 在。这是有意的安全选择。

## 为什么一次性明文显示

如果平台每次访问都明文显示 token，临时拿到屏幕的恶意行为者就能外泄。颁发时显示恰好一次明文意味着 token 以明文存在的时刻被限定在用户显式创建它的那一瞬。

之后用户操作的是 **ledger** — 一份记录：什么 token 存在、什么时候颁的、带什么范围、最后一次见是什么时候、撤销历史。

## Token Ledger

| 性质 | 值 |
| --- | --- |
| 可见性 | 颁发的 token 列表带元数据 |
| 可变性 | 仅追加；撤销作为事件被记下 |
| Token 明文 | 不存；颁发后不可取回 |
| 范围 | 每个 token 条目可见 |
| TTL | 每个 token 条目可见 |

回看 ledger 的用户能看到哪些 token 活跃、每个能干什么，并撤销不再想要的。

## 阅读场景：颁发有范围的 token

你想给外部 AI 宿主有界访问。

1. **打开外部 Agent 接入面板。** 通过桌面端 runtime 配置。
2. **配置。**
   - Principal id（外部 AI 的身份）
   - 账号上下文（你账号的范围）
   - 模式（通常 discovered + suggested only；很少 commit）
   - 动作（准入能力域 — `action.discover.*`、`action.dry-run.*`、`action.verify.*`、`action.commit.*`）
   - TTL（token 生命期）
3. **颁发。** 面板提交给 runtime；runtime 颁发有范围的 token。
4. **明文显示。** Token 显示一次。
5. **你复制 token。** 粘到外部 AI 宿主的配置里。
6. **Ledger 条目。** 面板现在显示带元数据的 ledger 条目；明文消失。

你用面板颁发；从那一刻起用 ledger 管理。

## 阅读场景：撤销 token

你不想再让某个外部 AI 宿主访问。

1. **Ledger。** 打开外部 Agent 接入面板。
2. **找到 token。** Ledger 列出活跃 token。
3. **撤销。** 提交撤销。
4. **Runtime 准入。** Token 撤销事件追加到 ledger。
5. **立即生效。** 该 token 的下一次请求在 runtime 准入授权下 fail-close。

撤销是真实的 — **不**是软性「请求被移除」。一旦撤销，token 不再授权任何东西。

## 阅读场景：Token 范围配错了

你不小心颁了一个带 `action.commit.gift` 的 token；本意只想要 discover + dry-run。

1. **Ledger。** 你在 ledger 里发现配错。
2. **撤销。** 撤掉错配的 token。
3. **重颁。** 用正确范围颁新 token。
4. **审计。** 撤销 + 重颁两个事件都被记下。

错配可恢复，因为面板 + ledger 让用户看到并动作。

## 为什么这个 UI 独有

外部 Agent 接入面板**是**外部 principal token 颁发的 UI。它**不**泛化到「任意 token」；它专属于外部 principal，因为它们是授权模型里真实的、命名的参与者种类。

通过这个面板创建别的 token 种类**未被准入**。其他 token 形状（用户 session token 等）住在别处。面板的窄是它安全姿态清晰的原因。

## 来源

- [`.nimi/spec/desktop/external-agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/external-agent.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/scoped-app-binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scoped-app-binding-contract.md)
- [`.nimi/spec/platform/ai-agent-security-interface.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-agent-security-interface.md)
- [`.nimi/spec/platform/ai-last-mile.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-last-mile.md)
