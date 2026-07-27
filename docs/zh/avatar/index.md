# Avatar

Avatar 关心的是 Agent 怎么被呈现——在某个窗口里、在虚拟形象里、在动画里。规则只有一句：呈现方式可以变，Agent 本身不会因为换了一种渲染方式就变成另一个 Agent。

## Avatar 究竟是什么

Avatar 不只是一张图。它是 AI 参与者的呈现层，并且这一层是受治理的。它涵盖视觉外形、动作、事件、每个 Carrier 表面愿意展示哪些部分，以及不同后端的渲染分支。

Avatar 之所以独立成为一个权威域，是因为呈现必须忠于 Agent 的真相，不能自己另搞一套。如果 Avatar 不动了，那是渲染的问题，Agent 并没有掉线；如果某个 Carrier 显示出来的样子和 Agent 的画像不一致，那是渲染层的差异，Agent 没有改变。

## Avatar 拥有什么、不拥有什么

Avatar 拥有：

- 具身化语义层契约：Agent 如何被呈现到 Carrier 上；
- Carrier 视觉接受契约：Carrier 在准入的形态下能否展示这套具身化；
- 各 Shell 自身的渲染分支：桌面端 Avatar 与其它 Shell 各有准入契约。

Avatar 不拥有：

- Agent 的身份：归 Runtime，由它持有 Agent 参与的真相和 Agent 的活体生命周期；
- Agent 的记忆：归 Cognition；
- 世界中的社交关系：归 Realm；
- 生成与执行：归 Runtime。

这条切分很重要。一个跑去管 Agent 身份或记忆的 Avatar 表面就成了平行权威，而不再是呈现域。

## 场景：某个 Carrier 没法显示一份具身化

某个 Agent 的具身化定义包含了当前 Carrier 渲染不了的动作。按 Avatar 契约处理：

1. Carrier 视觉接受契约决定这套具身化在该 Carrier 上能否准入。
2. 不能完全准入时，Carrier 不会悄悄渲染半成品。契约决定后续走向：退到准入的备选呈现方案、拒绝、或抛出强类型不兼容。
3. Runtime 与 Cognition 里的 Agent 真相不会因为 Carrier 这边发生了什么而改变。

呈现的问题留在 Avatar，Agent 仍然是 Agent。

## 场景：Avatar 为何独立于 Runtime

有人可能会问：呈现为什么不直接放在 Runtime 里？理由有三：

- 呈现要在不同 Carrier 上以不同方式渲染（桌面端 Avatar 以及未来其它 Carrier）；
- 呈现自己有视觉接受姿态；
- 呈现的问题可以作为渲染问题来调试和重放，而不是作为执行问题。

如果把呈现塞进 Runtime，这些关注点会挤掉 Runtime 本身的执行语义。把它们分开，每个域的契约才能各自聚焦。

## 来源依据

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`docs/spec/avatar-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/avatar-domain-index.md)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
