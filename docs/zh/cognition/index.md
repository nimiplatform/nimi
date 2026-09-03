# Cognition

Cognition 是 Nimi 里长期 Memory 的家。某个 Agent 记得你的名字、你的偏好、你上个月说过的事，这份记忆就来自 Cognition。

Cognition 在平台里是独立的所有者。Runtime 负责跑对话，Cognition 负责留住值得记住的东西。两者之间只有一条窄窄的强类型 Bridge，谁也不吞并谁。

## 对你意味着什么

- Agent 能跨会话记住你。关掉应用，下周再回来，同一个 Agent 仍然知道你告诉过它的事，前提是那些事值得保留。Memory 属于 Agent 本身，不属于某一段对话或某一个世界，所以它始终留在同一个 Agent 身上。
- Memory 按 Agent 隔离。同一个账号下的两个 Agent 各记各的，互相读不到对方的内容，背后也没有一份全账号共享的档案。
- 你可以纠正 Agent。当你说「我不住柏林了」，纠正后的事实立即成为当前认知，旧的退出默认召回，只留一份有来源边界的历史。
- 你可以让 Agent 彻底忘掉。显式遗忘会立下一道持久屏障：重启、重试、索引重建、事件重放，都没法把忘掉的内容带回来。
- 秘密不会变成记忆。密码、令牌、凭据，以及明确标注「不要记住」的内容，在保留之前就会被拒绝。
- 每份记忆都诚实标注来源：是你明确说过的、推断出来的，还是从更早的记忆归并而来的。

Memory 也允许缺席。召回还在构建、暂时不可用，或者确实没找到，对话都会照常继续，只是这一轮不带记忆。读取上的波折既不会编造结果，也不会卡住对话。写入则更严格：纠正和遗忘，只有在 Cognition 持久提交之后才算完成。

## Cognition 拥有什么

- 每个 Agent 的长期 Memory：一份不透明、按 Agent 隔离的逻辑 bank，只绑定一个 Agent。它不是账号档案，不是工作区 bank，也不是 App 能直接查询的东西。
- Memory 的真相与生命周期：准入、来源、纠正与取代、遗忘屏障、删除。
- V1 管线：一条 Remember 管线、一条全文召回管线、一条向量召回管线、一条确定性的精确 Forget 管线，外加一个为每次操作挑选一条管线的小型静态路由器。
- 派生的检索索引（全文与向量）。它们只是 canonical Memory 的可重建派生物，无权决定什么是真的。
- 一条有界的 Agent Source 通道：来自某个 Runtime 快照的强类型 source 单元，按 Agent 和快照隔离，为语义检索建立索引。它是派生状态，不是世界真相。

长期 Knowledge 也归 Cognition 的域，但 V1 没有启用任何 Knowledge 路径：目前没有任何产品面读写 Knowledge，Memory 也不会自动升级成 Knowledge。

## Runtime 和 Realm 手里留着什么

Runtime 继续掌管执行：LocalAgent 身份、授权、Conversation 与已提交事件、上下文规划、AI 执行，以及每一轮的最终提交。Runtime 先完成授权评估，Memory 操作才允许跨过 Bridge；Cognition 也只接受 Runtime 这一个调用方。

Realm 继续掌管世界真相。一份关于某个世界里发生过什么的记忆，不会改写那个世界的状态或历史。

App 和 SDK 碰不到 Cognition。它们能看到的 Memory，只是 Runtime 返回的有界结果。

## 读者场景：跨会话记住你

周一你告诉 Agent 你对花生过敏，当晚关了应用。周五你让它推荐零食。

1. 周一，Runtime 把你的消息提交为事件，经 Bridge 交付给 Cognition。
2. Cognition 的 Remember 管线判断它值得保留，提出这份记忆；Cognition Core 原子地提交它，来源标注为「你明确说过」。
3. 周五，Runtime 规划这一轮时向 Cognition 请求相关记忆，召返回来了过敏这一条。
4. Runtime 决定如何在上下文里使用这条命中。推荐的零食自然避开花生。

假如周五召回的索引还在构建，第 3 步会返回「不可用」而不是命中，这一轮照常继续，只是少了那条记忆。

## 读者场景：纠正与遗忘

假设 Agent 一直以为你在 Acme 上班。你告诉它：「我离开 Acme 了，现在在 Beta。」

1. 你的纠正作为一条新的已提交事件到达。
2. Cognition 让纠正后的事实成为当前版本，「在 Acme 工作」退出默认召回，只作为有来源边界的旧版本保留。

后来你进一步说：「把我旧工作的事全忘了。」显式遗忘会为这些记忆立下屏障。从那以后，重启、重试、索引重建、重放，都无法复活它们。哪天你重新提起旧工作，那是由新事件形成的新记忆，不是忘掉的那份回来了。

bank 按 Agent 隔离，所以这一切都不会波及你聊的其他 Agent。另一个 Agent 对你的记忆，是它自己的。

## 来源依据

- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
- [`nimi-cognition/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-cognition/README.md)
