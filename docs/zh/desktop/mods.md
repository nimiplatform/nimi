# 桌面端 Mod

Mod 是桌面端的有界扩展。它们强大，因为它们跑在用户面附近，所以能力模型需要显式治理。

支撑这页的 kernel 规则在桌面端 mod 治理合同、hook 能力合同、相关白名单表下。

## Mod 边界

Mod 应该用准入的 hook 能力。它们**不**应旁路 Runtime、SDK、桌面端合同；也**不**应造出跟宿主外壳矛盾的私有行为。

对读者而言，关键想法是：mod 的力量**应该**来自准入的 hook 面，不是来自原始访问。宿主外壳提供类型化 hook 点；mod 通过在白名单内注册到这些点上参与。

## 阅读场景：想读对话上下文的 mod

某 mod 作者想自己的 mod 在对话面发生轮次时响应：

1. 作者查桌面端 hook 能力表里准入了哪些 turn-hook 点。
2. Mod 注册到准入的 hook 点。它**不**订阅私有对话事件。
3. 轮次发生时，mod 在准入合同下收到类型化事件。
4. Mod 的响应受准入 hook 能力白名单约束。

如果 mod 想要的 hook 还不存在，正确路径是**提议**准入一个新 hook 点，不是发明私有的。

## 阅读场景：想读敏感 token 的 mod

某 mod 试图直接读敏感凭据。桌面端的 mod 治理合同**不**准入对那些材料的原始访问。Hook 能力白名单**不**包括「随便给我 token」。预期行为是：

- Mod 够不到敏感面。
- Mod 的白名单被强制。
- 如果 mod 的目的真的需要桥到某能力上，那能力得先被准入到白名单。

这就是让 mod 装着安心的原因。用户**不**必审计每个 mod 是否直接读凭据；合同层已经把那个面约束住了。

## Mod 生命周期

Mod 在桌面端 mod 治理合同里有定义好的生命周期：

- Mod 通过治理被准入到系统。
- 它可以被安装、激活、暂停、移除。
- 每次转换走 mod 生命周期状态表。

完整状态机住在 mod 生命周期状态表里；这页只讲它对 mod 作者意味着什么。

## Mod 能用哪些能力

Mod 能用的不是“桌面端里存在的一切”，而是白名单 hook 能力和宿主注入面。能力先进入 hook 白名单，mod 才能通过宿主外壳消费。

具体而言，mod 想消费的 Avatar、Cognition、Runtime 面仍受各自准入约束。底层域在别处准入了某能力**不**意味着 mod 能用 — 那能力还得在 hook 能力白名单里被准入。

## 来源

- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/hook-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/hook-capability-contract.md)
- [`.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml)
- [`.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml)
- [`.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml)
- [`.nimi/spec/desktop/kernel/tables/ui-slots.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/ui-slots.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml)
