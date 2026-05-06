# Avatar

Avatar 负责 Agent 的**呈现方式** — 在某个窗口、某个虚拟形象或者某个动画里，Agent 长什么样、怎么动。这一层的规则很清楚：呈现方式可以多样，但 Agent 自己不会因为渲染换了样子就变成另一个 Agent。

本页是产品域概览，不是已经做完的公开产品承诺。

## Avatar 到底是什么

Avatar 不只是一张图片。它是 AI 参与者的呈现层 — 涵盖形象、动作、事件，以及不同承载面（窗口、应用、设备）能不能显示这套形象、能显示成什么样。

Avatar 单独存在的原因是：呈现要**跟随** Agent 的真相，不能反过来定义 Agent。如果 Avatar 因为渲染出错停止动作，那是渲染问题，不会让 Agent 变成不在线；如果某个承载面把 Agent 显示成了和资料不一样的样子，那是渲染端的不匹配，不是 Agent 真的换了。

## Avatar 拥有 / 不拥有什么

Avatar 拥有：

- 具身呈现合同（Agent 如何在一个承载面上被呈现）；
- 承载面视觉接受合同（承载面是否能在已认可形状下显示这套具身）；
- 外壳特定的渲染分支（桌面端 Avatar 与其他外壳各自有已认可合同）。

Avatar **不**拥有：

- Agent 身份（Runtime 拥有 Runtime-owned Agent 参与真相和实时 Agent 生命周期）；
- Agent 记忆（Cognition 拥有记忆权威）；
- 世界社交关系（Realm 拥有）；
- 生成与执行（Runtime 拥有）。

这一切分很重要。一个滑入了 Agent 身份或记忆权威的 Avatar 面板，就成了**并行权威**，不再是表现域。

## 阅读场景：承载面显示不出某种形象

假设某个 Agent 的形象定义里有当前承载面渲染不了的动作。Avatar 合同会做这几件事：

1. 承载面视觉接受合同先判断这套形象在这个承载面上能不能用。
2. 如果不能完整支持，承载面**不会**自己渲染一个半成品。合同决定下一步：回退到一种能用的呈现方式、直接拒绝，或者发出有类型的不兼容信号。
3. Agent 在 Runtime 和 Cognition 里的真相**不会变**，不管承载面最后做了什么。

呈现问题留在 Avatar 域。Agent 还是那个 Agent。

## 阅读场景：Avatar 为什么不放进 Runtime

有人会问：呈现既然要随 Agent 走，为什么不放在 Runtime 里？原因是呈现这件事：

- 在不同承载面上要做不同的呈现（桌面端 Avatar、其他可能的承载面）；
- 有自己一套"哪些能显示"的判定逻辑；
- 出问题时是渲染问题，能独立调试，不是执行问题。

要是塞进 Runtime，这些关注会跟执行语义挤在一起。分开之后，每个域的合同都更聚焦。

## 来源

- [`.nimi/spec/avatar/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/index.md)
- [`.nimi/spec/avatar/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/index.md)
- [`.nimi/spec/avatar/kernel/app-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/app-shell-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/runtime/kernel/avatar-debug-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/avatar-debug-projection-contract.md)
