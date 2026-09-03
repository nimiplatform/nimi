# Avatar

Avatar 关心的是 Agent 怎么被呈现——在某个窗口里、在虚拟形象里、在动画里。规则只有一句：呈现方式可以变，Agent 本身不会因为换了一种渲染方式就变成另一个 Agent。

## Avatar 究竟是什么

Avatar 不只是一张图。它是 AI 参与者的整个呈现层：视觉外形、动作、事件、每个 Carrier 表面愿意展示哪些部分，以及不同后端的渲染分支。

呈现必须忠于 Agent 的真相，不能自己另搞一套。如果 Avatar 不动了，那是渲染的问题，Agent 并没有掉线；如果某个 Carrier 显示出来的样子和 Agent 的画像不一致，那是渲染层的差异，Agent 没有改变。

## Avatar 拥有什么、不拥有什么

Avatar 负责：

- Agent 的具身化怎么呈现到 Carrier 上；
- Carrier 能不能展示这套具身化、以什么形态展示；
- 各 Shell 自己的渲染分支：桌面端 Avatar 和其它 Shell 各有各的规则。

Avatar 不负责：

- Character 的持久身份（归 Realm）和 LocalAgent 的执行身份（Runtime 负责实例化与生命周期）；
- LocalAgent 的长期 Memory（长期 Memory 归 Cognition；Runtime 保留自己的运行时状态）；
- 世界里的社交关系（归 Realm）；
- 生成与执行（归 Runtime）。

这条切分很重要。如果一个 Avatar 表面开始决定"这个 Agent 是谁""它记得什么"，它就不再是呈现层，而是在和平台里真正负责这些事实的部分抢活干。

## 读者场景：某个 Carrier 没法显示一份具身化

某个 Agent 的具身化定义包含了当前 Carrier 渲染不了的动作。按 Avatar 契约处理：

1. Carrier 视觉接受契约决定这套具身化在该 Carrier 上能否准入。
2. 不能完全准入时，Carrier 不会悄悄渲染半成品。契约决定后续走向：退到准入的备选呈现方案、拒绝、或抛出强类型不兼容。
3. Realm 中的 Character 真相与 Runtime 中的 LocalAgent 真相不会因为 Carrier 这边发生了什么而改变。

呈现的问题留在 Avatar，Agent 仍然是 Agent。

## 读者场景：Avatar 为何独立于 Runtime

有人可能会问：呈现为什么不直接放在 Runtime 里？理由有三：

- 呈现要在不同 Carrier 上以不同方式渲染（桌面端 Avatar 以及未来其它 Carrier）；
- 呈现自己有视觉接受姿态；
- 呈现的问题可以作为渲染问题来调试和重放，而不是作为执行问题。

如果把呈现塞进 Runtime，这些关注点会挤掉 Runtime 本身的执行语义。把它们分开，每个域的契约才能各自聚焦。

## 来源依据

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
