# 会话能力

> 状态：运行中 (Running)。桌面会话能力合同 (`desktop/kernel/conversation-capability-contract.md`) 是已发布的每一会话能力协商界面。

桌面会话能力界面管理**会话支持哪些功能**——例如语音开启/关闭、图片附件开启/关闭、工具调用准入等——在每个会话的粒度上。能力集是针对每个会话的，而不是全局针对每个代理的。

## 为什么是每一会话

用户可能希望在一个与代理的会话中使用语音，而在另一个会话中不使用。一个群组线程可能允许图片附件，而一个二元聊天则不允许。每一会话的协商机制可以捕捉到这一点，而无需强制统一“该代理始终开启语音”。

## 边界

| 拥有 | 不拥有 |
| --- | --- |
| 每一会话的能力状态 | 领域线程/成员关系真相（领域） |
| 能力协商 UI | 语音/图片/工具执行（运行时 + 每个领域的合同） |
| 锚定范围的能力准入 | 代理参与配置文件（运行时） |

能力状态是桌面端每一会话的真实情况。它不会被提升为运行时持久配置文件或领域规范真相。

## 读者场景：用户为一次会话切换语音

1. **用户切换语音开启。** 桌面会话能力更新每一会话的状态。
2. **后续回合允许语音路径。** 语音会话合同为此会话激活。
3. **其他会话不受影响。** 每一会话的作用域得到尊重。

## 会话能力不做的事情

- 它不会成为规范的代理展示配置文件。
- 它不会重新定义语音/图片/工具的语义。
- 它不会将每一会话的状态提升为全局代理状态。

## 来源依据

- [`.nimi/spec/desktop/kernel/conversation-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/conversation-capability-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)