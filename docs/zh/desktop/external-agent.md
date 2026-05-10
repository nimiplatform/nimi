# 外部 Agent 接入

## 状态：现在 (Running today)

外部 Agent 接入面是桌面端已交付的 ExternalPrincipal token 颁发与撤销 UI。

外部 Agent 接入面板是桌面端独有的 UI，用来管理 `ExternalPrincipal` Token。它是"以受控、限定作用域、可撤销的方式让外部 AI 宿主访问我的 Nimi 账户"这件事的操作界面。

平台层模型见 [平台 → Agent → 外部 Agent](/zh/platform/agents/external-agents)。

## 这个面板做什么

| 步骤 | 行为 |
| --- | --- |
| 读取网关状态 | 显示当前外部 Agent 网关状态 |
| 配置 | 选 principal id / 账户 / 模式 / 动作 / TTL |
| 颁发 Token | 提交后由 Runtime 签发限定作用域 Token |
| 明文展示 | 仅一次明文展示已签发的 Token |
| Token 账本 | 后续可见性只通过不可变账本 |
| 撤销 / 列表 | 在账本上操作（撤销、查看在用 Token） |

这块面板是这类 Token **唯一**的签发与明文呈现入口。签发后 Token 不再可见，只能看到账本条目。这是有意为之的安全选择。

## 为什么只展示一次明文

如果每次进入都把 Token 明文显示出来，攻击者只要短暂看到屏幕就能带走。只在签发时展示一次明文，意味着 Token 的明文存在被严格限制在用户主动创建它的那一刻。

之后用户操作的对象是**账本**——一份记录：哪些 Token 在用、何时签发、作用域是什么、最近活跃时间、撤销历史。

## Token 账本

| 维度 | 取值 |
| --- | --- |
| 可见内容 | 已签发 Token 的元数据列表 |
| 可变性 | 仅追加；撤销以事件形式记录 |
| Token 明文 | 不存储；签发后不可取回 |
| 作用域 | 每条目可见 |
| TTL | 每条目可见 |

用户翻阅账本就能看到哪些 Token 在用、各能做什么，并撤销不再需要的。

## 场景：签发一个限定作用域的 Token

你想给某个外部 AI 宿主发一份受限访问。

1. **打开外部 Agent 接入面板**，从桌面端 Runtime 配置进入。
2. **配置**。
   - Principal id（外部 AI 的身份）
   - 账户上下文（你的账户作用域）
   - 模式（通常是 discovered + suggested 为主，commit 罕用）
   - 动作（已准入的能力域：`action.discover.*`、`action.dry-run.*`、`action.verify.*`、`action.commit.*`）
   - TTL（Token 寿命）
3. **签发**。面板提交到 Runtime；Runtime 签发限定作用域 Token。
4. **明文展示**。Token 显示一次。
5. **复制**。粘贴到外部 AI 宿主的配置里。
6. **账本条目**。面板显示这条 Token 的元数据，明文已经消失。

签发用面板，签发之后用账本管理。

## 场景：撤销一个 Token

你不再希望某个外部 AI 宿主继续访问。

1. **打开账本**。进入外部 Agent 接入面板。
2. **找到这条 Token**。账本列出在用 Token。
3. **撤销**。提交撤销。
4. **Runtime 准入**。撤销事件追加到账本。
5. **立即生效**。下一次该 Token 的请求在 Runtime 授权层失败拒绝。

撤销是真实的，不是"软删"或"已请求"。撤销后这条 Token 不再授权任何内容。

## 场景：作用域配错了

你不小心给一条 Token 配了 `action.commit.gift`，本意只想给 discover + dry-run。

1. **账本**。在账本上发现配置不对。
2. **撤销**。把这条 Token 撤销。
3. **重新签发**。按正确作用域签发新 Token。
4. **审计**。撤销与重新签发两个事件都被记录。

错配是可挽回的，因为面板加账本让用户能看到、能动手。

## 这块 UI 为什么是独立的

外部 Agent 接入面板就是外部 principal Token 签发的那块 UI。它不是"任意 Token"的通用工具；而是专门为外部 principal 设计——因为外部 principal 在授权模型里是真实存在的具名参与者。

通过这块面板创建其他类型的 Token 不准入。其他 Token 形态（用户会话 Token 等）归别处。窄，是这块面板安全姿态清晰的关键。

## 来源依据

- [`.nimi/spec/desktop/external-agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/external-agent.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/scoped-app-binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scoped-app-binding-contract.md)
- [`.nimi/spec/platform/ai-agent-security-interface.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-agent-security-interface.md)
- [`.nimi/spec/platform/ai-last-mile.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-last-mile.md)
