# AI 最后一公里

AI 最后一公里就是 Agent 的"意图"和平台上"真实动作"之间的桥。它就是 Model 说"送一份礼物"的时候，平台决定"做"、"问用户"还是"拒绝"的那一刻 — 都在显式、可审计的合同下进行。

本页介绍 **Hook Action Fabric**，统一服务于 Nimi 内部 Agent 和外部 AI 宿主的动作面。

## 它解决什么问题

大多数 AI 产品对最后一公里的解决办法是让 AI 模拟人类：通过屏幕控制面去点按钮、在表单里打字、拖动窗口。这个方法做 demo 行得通，做平台行不通 — 没有审计，没有 scope，没有同意模型，平台也分不清"真实用户点击"和"合成点击"的区别。

Nimi 走相反的路：AI Agent 调用为它们设计的、有类型的能力 API。动作是一等的、被准入的操作，**不是**伪装成点击的屏幕动作。

## Hook Action Fabric 是什么

Hook Action Fabric 由 Runtime + 桌面端的 Hook 能力沙箱共同构成。两者一起提供：

- **类型化的动作动词**。每个被准入的能力域都有自己的动作 API（`action.discover.*`、`action.dry-run.*`、`action.verify.*`、`action.commit.*`）。
- **最小权限的 scoped 授权**。Token 带显式 scope，能力是 scope 说的，不是 Agent 想要的。
- **控制面 / 数据面分离**。授权决策在控制面；数据面跟随控制面的判定。
- **默认 fail-closed**。没有被准入的能力就是不可用。未知动词不会悄悄回退到一个通用动作。

对 Agent 来说意思是：在你的 token scope 下要你**真正需要**的类型化动词，得到的要么是真实结果，要么是有类型的拒绝。

## 内部 Agent 和外部 Agent

Hook Action Fabric 对两边是同一个面。Nimi 内部的 Agent（life-track 或 chat-track）和外部 AI 宿主（通过 `ExternalPrincipal`）都调类型化能力，都过防火墙，都留下审计 lineage。

差异在策略：

| 因素 | 内部 Agent | External Principal |
| --- | --- | --- |
| 信任层级 | 默认绑定到用户账号 | `CONTROLLED_LOCAL` / `USER_ADDED_REVIEWED` / `ORG_MANAGED` / `BLOCKED` |
| Token 形状 | Runtime 签发 + 已认可 scope | 单次明文显示 + immutable ledger |
| 批准策略 | 由用户偏好决定 | 由用户偏好 + 能力敏感度决定 |
| 审计 lineage | 记在 runtime audit 里 | 记录时附带委派 lineage 扩展 |

能力面是相同的。差的只是信任层级和批准策略。

## 阅读场景：外部 AI 建议送一份礼物

你把一个外部 AI 宿主加为委派 principal。它建议给一个朋友送礼物。

1. **建议到达**。外部 AI 发出一个类型化的委派请求：`SUGGEST_INTENT { action: gift.send, recipient: ..., item: ... }`。
2. **输出防火墙校验**。防火墙检查 schema、来源、descriptor hash；分类敏感度；检测 prompt poisoning；推断批准要求。
3. **裁决**。防火墙发出以下之一：`ACCEPTED_OBSERVATION`、`ACCEPTED_SUGGESTION`、`APPROVAL_REQUIRED`、`QUARANTINED`、`REJECTED`、`PROVIDER_DRIFTED`、`SCHEMA_INVALID`、`POLICY_BLOCKED`。送礼通常是 `APPROVAL_REQUIRED`。
4. **批准提示**。桌面端弹出一张类型化的批准卡 — "外部 AI X 建议给 Z 送礼物 Y"。你点批准或拒绝。
5. **Runtime 执行**。批准后，**Runtime**（不是外部 AI）通过 Realm 提交礼物。这次动作的审计 lineage 链回原始建议、防火墙裁决和你的批准。

外部 AI **从来没有**直接改 Realm。它提议；Runtime 重新授权；你同意；Runtime 提交。这条链就是建议是安全的原因。

## 阅读场景：内部 Agent 给自己排日程

一个 Life Track 上的内部 Agent 想提醒自己明天跟进某件事。

1. **Hook intent**。Agent 发出一个类型化的 `HookIntent` — "T+24h 跟进"。
2. **Runtime 校验**。Runtime 拿这个 intent 去对照已认可的 hook 合同和 Agent 的 life-track token 预算。
3. **准入**。如果被准入，intent 进入 hook 生命周期：`pending → running → completed | failed | canceled | rescheduled | rejected`。
4. **将来触发**。时间到了，hook 在 Runtime 调度下触发；Agent 的 life-track 按已认可节奏和预算被调起。

注意 Agent **没有做**什么：没自己写调度器；没发明自由形式的调度字符串；没绕过预算。Hook intent 合同就是"给自己排日程"这件事的类型化动词。

## 为什么"类型化动词"而不是"合成点击"

| 关注 | 类型化动词带来什么 |
| --- | --- |
| 审计 | 每个动作是一个有结构 lineage 的类型化事件 |
| Scope | 能力被 token scope 限定，不是被屏幕暴露的部分限定 |
| 同意 | 敏感动作有类型化的批准提示，不是任意"你确定吗？"对话框 |
| Provider 漂移 | descriptor hash 不匹配会隔离会话；合成点击没有 descriptor |
| 可重现 | 重放可以从类型化日志重新推导动作 |
| 策略 | 信任层级和策略快照应用到每个动作；不会因为点击就提权 |

一个把 AI 暴露给合成点击的平台对上面任何一项都没有答案。一个给 AI 类型化动作动词的平台对每一项都有答案，而且是结构性的。

## 来源

- [`.nimi/spec/platform/ai-last-mile.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-last-mile.md)
- [`.nimi/spec/platform/ai-agent-security-interface.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-agent-security-interface.md)
- [`.nimi/spec/platform/kernel/ai-last-mile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-last-mile-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-approval-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-approval-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md)
- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
