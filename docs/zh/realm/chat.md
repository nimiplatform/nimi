# Chat

Realm Chat 持有规范的 thread / message / 已读状态 / 成员 / 群生命周期 / agent slot 这一整套面向"参与世界语义"的聊天表面。它是**规范层**的：不归桌面端，不归会话，thread 本身就是平台真相。

## 两种载体

Realm Chat v1 准入两种载体：

| 载体 | 用途 |
| --- | --- |
| `DIRECT` | 两人直接私聊 |
| `GROUP` | 多人群聊，可包含人类成员和 agent slot |

`CHANNEL` 这种载体在 v1 不准入，fail-closed。这是有意为之的限制：channel 风格的流式订阅需要它自己的准入契约，不属于 v1 chat 范围。

## 群聊与 Agent Slot

`GROUP` thread 的成员可以混合人类和 agent slot / 作者。Agent slot 是一种强类型准入：声明某个 agent 以作者身份参与到这个 group 里。

| 属性 | 值 |
| --- | --- |
| 成员 | 人类 + agent slot |
| Agent 发言 | commit 之前先校验 thread / slot 绑定（防伪） |
| Slot 生命周期 | 已准入；agent 进入 / 离开 slot 都走强类型事件 |

防伪发生在协议层。一个企图"以这个 agent 名义"发言但没有 slot 绑定的恶意发件方，会直接 fail-closed。

## 防伪校验

收到一条 agent 发言时，Realm 校验：

| 检查 | 内容 |
| --- | --- |
| Slot 绑定 | 这个 agent 是否在该 thread 的 slot 中已准入？ |
| 作者身份 | 发言里声明的作者是否对得上 slot 绑定？ |
| 成员资格 | 这个 thread 是否允许 agent 发言？ |
| 时间窗 | 这条发言是否落在准入的 authorship 窗口内？ |

任意一项失败都 fail-closed。Thread 不会默默接受没过校验的发言。

正因为有协议层的防伪，"群聊里有一个 agent"才是真实产品特性。没有它，"agent 说了 X"就是一个可以伪造的声明。

## 场景：一段直接对话

你私聊另一位用户。

1. **DIRECT 载体**。Realm 准入一条 `DIRECT` thread，成员是你和对方。
2. **发送**。你的消息 commit 到 thread。
3. **实时投递**。对方通过 Socket.IO 实时收到。
4. **已读状态**。已读是规范层数据，你这一端的"已读"被记进 thread。

Thread 本身就是 Realm 的规范真相。换设备不需要重新同步，规范 thread 就是来源。

## 场景：群聊中带一个 agent slot

你和朋友们在一个群里，群里还接入了一个 agent slot。

1. **GROUP 载体**。Realm 准入一条 `GROUP` thread，成员包含人类和一个 agent slot。
2. **Agent 发言**。Agent 的 runtime 为这条 thread 产出一轮发言时，发言带着 agent 身份到达 Realm。
3. **防伪校验**。Realm 校验 slot 绑定、作者身份、成员资格、时间窗。
4. **校验通过则 commit**。发言准入；群成员看到。
5. **校验未过则拒收**。fail-closed；群成员看不到。

Slot 是 agent 参与群聊的强类型通道。没有 slot 绑定的 agent 没法在群里发言。

## 场景：跨设备的已读状态

你在桌面端读了一条消息，然后打开 Avatar 上的同一个对话。

1. **桌面端读取**。已读状态 commit 到 Realm。
2. **Avatar 打开**。Avatar 读取规范 thread，包括已读状态。
3. **Avatar 知道你已读过**。不会把读过的消息当成未读重新提示。

已读状态是平台真相，不是单个表面的本地状态。这是多表面聊天能保持一致的原因。

## Chat 与其他 Realm 表面的关系

| 表面 | 关系 |
| --- | --- |
| Social（`R-SOC-*`） | 朋友关系是私聊的前置条件；社交不持有 thread 本身 |
| Truth（`R-TRUTH-*`） | 影响世界语义的聊天可参与到真相 |
| World History（`R-WHIST-*`） | 进入规范历史的聊天事件追加到这里 |
| Runtime ConversationAnchor | 对话连续性归 Runtime；规范 thread 归 Realm |

## Chat 不做的事

| 关注点 | 不做的原因 |
| --- | --- |
| 持有对话连续性 | 归 Runtime ConversationAnchor |
| 持有 agent 执行 | 归 RuntimeAgentService |
| 持有 UI 渲染 | 归桌面端聊天表面 |
| 准入 `CHANNEL` 载体 | v1 不准入；fail-closed |

## 来源依据

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
