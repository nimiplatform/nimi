# Hook intent

`HookIntent` 是 Agent 请求未来定时动作的强类型契约。模型不能输出自由格式的调度逻辑，它输出的是强类型的 Hook intent，由 Runtime 校验和准入。

这就是「一个 Agent 决定明天给你回访」之所以是真实能力，而不是一段自由提示词的根据。

## Hook intent 解决的问题

朴素的 Agent 设计会让模型输出类似「明早 9 点提醒用户面试」这样的字符串。这串字符本身不是真正的调度，它只是模型的输出，需要某段下游代码去解释，再变成真正定时的调用。

由此会有两种失败模式：

- **自由格式解读**。不同代码路径对同一串字符的解读不同，Agent 的意图与真实发生的事会偏移。
- **能力失控**。如果 Agent 想要什么就能要什么，那平台就要为所有事情准备一个沙箱。

Nimi 的回应：Agent 输出的是**强类型的 `HookIntent` 记录**，不是自由字符串。Intent 带强类型动词、强类型参数，并且有一份 Runtime 校验依据的契约。模型负责提议；Runtime 负责准入或拒绝；准入的 Intent 进入强类型的生命周期。

## `HookIntent` 承载的内容

一份强类型 Intent 记录描述：

| 字段 | 含义 |
| --- | --- |
| Intent 类型 | 请求的是哪一种未来动作 |
| 参数 | 该类型对应的强类型参数 |
| 调度 | 什么时候触发（绝对、相对、条件） |
| 作用域 | 在谁的上下文里执行 |
| 审批要求 | 触发前是否需要用户同意 |

类型与参数都在 Runtime 内核里准入；Agent 不能临时发明新类型。未声明的类型 fail-closed。

## Hook 生命周期

Intent 准入之后，进入 Hook 生命周期：

| 状态 | 含义 |
| --- | --- |
| `pending` | 已准入，等触发 |
| `running` | 正在执行 |
| `completed` | 成功的终态 |
| `failed` | 失败的终态 |
| `canceled` | 触发前取消 |
| `rescheduled` | 改了时间，回到 `pending` |
| `rejected` | 在准入阶段被拒 |

任何 Agent 的 Hook 都共用这套状态机。一份没到 `pending` 的 Intent，就是 Runtime 拒绝准入的那一份。

## 场景：Agent 给自己排一次跟进

用户提到明早 9 点有面试。Agent 决定提醒用户。

1. **Agent 输出强类型 Intent**。模型经由 APML 线格式输出一份强类型 `HookIntent` 记录：类型 = `remind`，参数 = `{ subject: "interview", target: <user>, message: "good luck" }`，调度 = `tomorrow at 8am`，作用域 = `chat conversation X`。
2. **Runtime 校验**。`remind` 类型已准入；参数符合契约；调度时间在 Agent 的生命轨迹预算内。
3. **准入**。Runtime 准入 Intent。到点时 Hook 从 `pending → running`。
4. **触发**。明早 8 点，Hook 跑起来。Agent 的生命轨迹按准入的节奏与预算给出提醒。
5. **终态**。Hook 完成。审计记录这次触发。

没有发生的事：

- 模型没有输出自由格式的调度字符串。
- 用户不需要为这一次 Hook 单独授一道新权限。
- Hook 没有绕开当日的 token 预算。

强类型契约让这件事既安全又可预期。

## 场景：Intent 被拒

某 Agent 试图输出一份在该类型契约下不被准入的 Intent —— 也许参数违反了敏感度规则，也许 Agent 对目标没有相应能力。

1. **校验失败**。Intent 不符合准入契约。
2. **状态**。Intent 进入 `rejected`，不进入 `pending`。
3. **审计**。拒绝连同原因被记录。
4. **Agent 可见**。拒绝以强类型形式回到 Agent 那一侧，Agent 下一回合可以换一种做法。

拒绝不是静默的。Runtime 会告诉 Agent 为什么；Agent 的下一步可以据此调整。

## 场景：Hook 被改时间

某条已排的 Hook 需要挪一下，可能是 Agent 拿到新的信息，原定时间不再合适。

1. **改时间请求**。Agent 输出一份强类型的改期请求，引用既有 Intent。
2. **校验**。Runtime 检查这次改期是否在该 Intent 的准入范围内。
3. **状态**。Hook 走到 `rescheduled`，再以新时间回到 `pending`。
4. **审计**。改期血缘被记录。

`rescheduled` 是过渡态，不是终态。它捕获「调度被改过」这件事；审计让后来读这段历史的人能看见原因。

## 为什么是「强类型 Intent」而不是「自由字符串」

| 关注点 | 强类型 Intent 的回答 |
| --- | --- |
| 审计 | 每份 Intent 都是带结构化血缘的强类型记录 |
| 能力边界 | 类型与参数是准入的，无自由格式可言 |
| 重放 | 重放可以按 Intent 记录逐步还原，不必再次推断 |
| 审批 | 敏感度由强类型类型推得 |
| 预算 | token 预算在准入时强制，不是触发时 |
| 调度可靠性 | Runtime 持有调度器；模型不发明时间语义 |

让模型输出自由格式调度字符串的平台，没有这些回答。强制强类型 Intent 的平台，按构造就拥有它们。

## 来源依据

- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-output-wire-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/runtime/kernel/audit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/audit-contract.md)
