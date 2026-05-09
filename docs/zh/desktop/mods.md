# 桌面端 Mod

Mod 是桌面端的有界扩展。它们能力强，因为靠近用户面运行，所以能力模型必须有显式治理。

这一页背后的内核规则，归在桌面端 Mod 治理契约、Hook 能力契约，以及相关的白名单表中。

## Mod 边界

Mod 应当只使用准入的 Hook 能力。它们不能绕过 Runtime、SDK、桌面端契约，也不能造出与宿主外壳相违背的私有行为。

对读者来说，关键在于：Mod 的能力来自准入的 Hook 面，不来自 raw 访问。宿主外壳暴露强类型 Hook 点，Mod 在白名单内对这些点做注册，从而参与整个面。

## 场景：Mod 想读取会话上下文

某 Mod 作者希望在会话面里发生回合时做出反应：

1. 作者先查桌面端 Hook 能力表，看哪些回合 Hook 点是准入的。
2. Mod 注册到准入的 Hook 点上，不订阅私有的会话事件。
3. 回合发生时，Mod 在准入契约下收到强类型事件。
4. Mod 的反应受准入的 Hook 能力白名单约束。

如果 Mod 想要的 Hook 还不存在，正确做法是提议准入一个新的 Hook 点，而不是自己造一个私有的。

## 场景：Mod 想直接读敏感令牌

某 Mod 试图直接读取敏感凭据。桌面端的 Mod 治理契约不准入对这类材料的 raw 访问。Hook 能力白名单里也没有「给我任意 token」这一项。预期的行为是：

- Mod 触不到敏感面。
- Mod 的白名单被强制执行。
- 如果 Mod 的目的真的需要某项跨域能力，就要先把这项能力准入到白名单里。

这就是为什么装 Mod 仍然安全。用户不必逐个审计 Mod 是否在窃取凭据；契约层已经约束了这一面。

## Mod 生命周期

Mod 在桌面端 Mod 治理契约里有明确的生命周期：

- Mod 通过治理被准入。
- 它可以被 install、active、suspended、removed。
- 每一个状态转移都按 mod-lifecycle states 表来。

公共文档不在这里展开完整的状态机，权威的形式以内核表为准。

## Mod 能消费的范围

Mod 能消费的 Avatar、Cognition、Runtime 面，都受各自的准入约束。即使底层域在别处准入了某项能力，只要 Hook 能力白名单没收录，Mod 仍然不能用。

## Source Basis

- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/hook-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/hook-capability-contract.md)
- [`.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml)
- [`.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml)
- [`.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml)
- [`.nimi/spec/desktop/kernel/tables/ui-slots.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/ui-slots.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml)
