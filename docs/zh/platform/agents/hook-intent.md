# Hook Intent

`HookIntent` 是 Agent 请求未来定时动作的类型化合同。Model 不能发出自由形式的调度逻辑；它发的是类型化的 hook intent，由 Runtime 校验和准入。

这就是让"Agent 决定明天跟你跟进"成为真能力，而不是一句自由形式提示。

## Hook Intent 解决什么

朴素的 Agent 设计让 Model 说一句"明天 9 点提醒用户面试"。这句话本身**不是**真的日程 — 它是 Model 输出，下游某段代码要去解释、变成真正的定时调用。

后果是两种失败模式：

- **自由形式解释**。不同代码路径解释这串字不同；Agent 的意图和真实发生的事漂移。
- **能力扩散**。如果 Agent 能请求任何事，那它需要一个全能沙箱。

Nimi 的回应：Agent 发出**类型化的 `HookIntent` 记录**，不是自由形式的字串。intent 有类型化动词、类型化参数、合同。Model 提议；Runtime 准入或拒绝；被准入的 intent 进入类型化生命周期。

## `HookIntent` 装什么

| 字段 | 含义 |
| --- | --- |
| Intent kind | 请求什么样的未来动作 |
| Parameters | 该 kind 特有的类型化参数 |
| Schedule | 何时触发（绝对、相对、条件） |
| Scope | 在谁的上下文下跑 |
| Approval requirement | 触发前是否要用户批准 |

Kind 和参数是在 Runtime kernel 里准入的；Agent 不能发明新 kind。未声明的 kind fail-closed。

## Hook 生命周期

被准入后，intent 进入 hook 生命周期：

| 状态 | 含义 |
| --- | --- |
| `pending` | 已准入；等触发时间 |
| `running` | 正在执行 |
| `completed` | 终态成功 |
| `failed` | 终态失败 |
| `canceled` | 完成前被取消 |
| `rescheduled` | 移到新日程；回到 `pending` |
| `rejected` | 准入时被拒 |

任何 Agent 的 hook 状态机都一样。没到达 `pending` 的 intent 是 Runtime 拒绝准入的那种。

## 阅读场景：Agent 排一次跟进

用户提到明天 9 点有面试。Agent 决定提醒用户。

1. **Agent 发类型化 intent**。通过 APML 线格式，Model 产生一个类型化 `HookIntent` 记录：kind = `remind`，parameters = `{ subject: "面试", target: <user>, message: "祝好运" }`，schedule = `明天 8 点`，scope = `chat conversation X`。
2. **Runtime 校验**。kind `remind` 已认可。参数符合合同。schedule 在 Agent 的 life-track 预算分配范围内。
3. **准入**。Runtime 准入 intent。hook 在触发时间从 `pending → running`。
4. **触发**。明天 8 点 hook 跑。Agent 的 life-track 在已认可的节奏和预算下产生提醒。
5. **终态**。hook 完成。审计记录这次触发。

**没发生的事**：

- Model 没发自由形式调度字串。
- 用户没必要授新权限给这个 hook。
- hook 没绕过日 token 预算。

类型化合同就是让这件事**安全**且**可预测**的原因。

## 阅读场景：被拒的 intent

Agent 试图发一个 `HookIntent`，但是这个 kind 的合同不准入这个动作 — 也许参数违反敏感规则，或者 Agent 没有目标的能力。

1. **校验失败**。intent 不符合已认可合同。
2. **状态**。intent 进入 `rejected`。它没进 `pending`。
3. **审计**。拒绝带原因被记录。
4. **Agent 学到**。拒绝对 Agent 是可观察的（类型化形式），所以 Agent 下一步可以选别的方法。

拒绝不是无声的。Runtime 告诉 Agent 为什么；Agent 下一轮可以调整。

## 阅读场景：hook 改期

一个排好的 hook 需要换时间 — 也许 Agent 有了新信息，原时间不再合适。

1. **改期请求**。Agent 发一个引用现有 intent 的类型化改期请求。
2. **校验**。Runtime 检查这次改期对该 intent 是否准入。
3. **状态**。hook 进 `rescheduled`，再回 `pending`，新时间。
4. **审计**。改期 lineage 被记录。

`rescheduled` 是过渡态，不是终态。它捕获"日程变了"这件事；审计让以后读的人能看到为什么。

## 为什么"类型化 intent，不是自由形式字串"

| 关注 | 类型化 intent 给你什么 |
| --- | --- |
| 审计 | 每个 intent 是有结构 lineage 的类型化记录 |
| 能力边界 | kind + 参数已认可；没有自由形式 |
| Replay | 重放可以走 intent 记录，而不是重新推断 |
| 批准 | 敏感性可从类型化 kind 推导 |
| 预算 | Token 预算在准入时执行，不在触发时 |
| 调度可靠性 | Runtime 拥有调度器；Model 不发明时序语义 |

让 Model 发自由形式调度字串的平台对上面任一项都没答案。要求类型化 intent 的平台对每一项都有答案，而且是结构性的。

## 来源

- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-output-wire-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/runtime/kernel/audit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/audit-contract.md)
