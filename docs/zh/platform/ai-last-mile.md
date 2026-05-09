# AI 最终执行环节（AI Last Mile）

## 状态：已准入，建设中 (Admitted, in build-out)

Hook Action Fabric + Principal 模型 + 执行协议状态机已在内核层准入 (P-ALMI-002, P-ALMI-003, P-ALMI-011)。

AI 的最终执行环节，指的是从 Agent 形成意图，到平台上真正发生一次操作之间的那一段。当模型说"送一份礼物"时，平台要么真的送出去，要么停下来问用户，要么直接拒绝——所有这些动作都必须发生在显式、可审计的契约之下。

本页介绍 **Hook Action Fabric**：Nimi 内部 Agent 与外部 AI 宿主共用的统一动作面。

## 它解决的问题

主流 AI 产品在最终执行环节的常见做法，是让 AI 模仿人来操作：透过屏幕控制点按钮、填表单、拖窗口。这种方式在 demo 里能跑，放到平台上就会塌——没有审计、没有作用域、没有同意模型，平台也分不清这次点击是真人发起的还是 AI 合成的。

Nimi 选择了相反的做法：让 Agent 直接调用为它设计的强类型能力 API。动作是显式准入的一等操作，不是伪装成点击的副产品。

## Hook Action Fabric 是什么

Hook Action Fabric 由 Runtime 加上桌面端 Hook 能力沙箱组成，提供四件事：

- **强类型动作动词**。每个准入的能力域有自己的动作 API：`action.discover.*`、`action.dry-run.*`、`action.verify.*`、`action.commit.*`。
- **最小权限的作用域授权**。Token 上挂着显式作用域，能力以作用域为准，不以 Agent 的意愿为准。
- **控制面与数据面分离**。授权决策在控制面，数据面只负责执行控制面的裁决。
- **默认 fail-closed**。未准入的能力直接不可用；未知动词不会悄悄退化为某个泛用动作。

对 Agent 而言只有一句话：在自己 Token 的作用域内请求真正需要的那个动词，拿到的要么是真实结果，要么是一份强类型的拒绝。

## 内部 Agent 与外部 Principal

Hook Action Fabric 对两者是同一张面。Nimi 自带的 Agent（生命轨迹或对话轨迹）与通过 `ExternalPrincipal` 接入的外部 AI 宿主，调用的是同一组强类型能力，过的是同一道防火墙，留下的是同一种审计链路。

差别只在策略：

| 维度 | 内部 Agent | 外部 Principal |
| --- | --- | --- |
| 信任层级 | 默认绑定到用户账户 | `CONTROLLED_LOCAL` / `USER_ADDED_REVIEWED` / `ORG_MANAGED` / `BLOCKED` |
| Token 形态 | Runtime 颁发，带准入作用域 | 一次性明文展示，配不可变账本 |
| 审批策略 | 由用户偏好决定 | 由用户偏好和能力敏感度共同决定 |
| 审计链路 | 计入 Runtime 审计 | 额外附带委派链路扩展 |

能力面本身完全相同，差别只在信任层级和审批策略。

## 场景：外部 AI 建议送礼物

你把一个外部 AI 宿主接入为受委派的 Principal，它建议给某位联系人送一份礼物。

1. **建议到达**。外部 AI 发来一份强类型委派请求：`SUGGEST_INTENT { action: gift.send, recipient: ..., item: ... }`。
2. **出站防火墙校验**。防火墙核对 schema、来源和描述符哈希，划分敏感度，识别 prompt 注入，推导出本次该走哪一档审批。
3. **裁决**。防火墙吐出一个结果：`ACCEPTED_OBSERVATION`、`ACCEPTED_SUGGESTION`、`APPROVAL_REQUIRED`、`QUARANTINED`、`REJECTED`、`PROVIDER_DRIFTED`、`SCHEMA_INVALID`、`POLICY_BLOCKED`。送礼物这种动作，常见结果是 `APPROVAL_REQUIRED`。
4. **审批提示**。桌面端弹出一张强类型审批卡——"外部 AI X 想给 Z 送 Y"——你点同意或拒绝。
5. **Runtime 落实**。一旦同意，是 Runtime 而不是外部 AI，向 Realm 提交礼物。这次动作的审计链回连到原始建议、防火墙裁决、用户同意三段证据。

外部 AI 自始至终没有直接改过 Realm。它只能提议；Runtime 重新授权；用户同意；Runtime 提交。这条链才是建议得以安全的真正原因。

## 场景：内部 Agent 给自己排期

生命轨迹上的某个 Agent 想提醒自己 24 小时后做一次跟进。

1. **Hook intent**。Agent 发出一份强类型 `HookIntent`："T+24h 跟进"。
2. **Runtime 校验**。Runtime 拿这份意图比对已准入的 Hook 契约，并核对 Agent 在生命轨迹下的 Token 预算。
3. **准入**。如准入，意图进入 Hook 生命周期：`pending → running → completed | failed | canceled | rescheduled | rejected`。
4. **到点触发**。时间到时，Hook 在 Runtime 的调度下被触发。Agent 的生命轨迹按它准入的节奏与预算被唤起。

注意 Agent 没有做的事：它没有自己写一个调度器，没有发明一段自由格式的排期描述，也没有绕开预算。Hook intent 契约就是"给自己排期"这件事的强类型动作动词。

## 为什么是"强类型动词"，而不是"合成点击"

| 关注点 | 强类型动词的回答 |
| --- | --- |
| 审计 | 每次动作都是带结构化链路的强类型事件 |
| 作用域 | 能力以 Token 作用域为准，而不是屏幕上恰好露出来的那些控件 |
| 同意 | 敏感动作走强类型审批卡，而不是泛泛的"是否确认" |
| 供应方漂移 | 描述符哈希不一致就隔离会话；合成点击根本没有描述符 |
| 可重放 | 重放可以从强类型日志反推出原动作 |
| 策略 | 信任层级与策略快照对每次动作都生效；点击不会带来权限提升 |

以"合成点击"作为 AI 控制面的平台，对上面这些问题没有答案。采用"强类型动词"作为 AI 控制面的平台，则从结构上解决了这些问题。

## 来源依据

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
