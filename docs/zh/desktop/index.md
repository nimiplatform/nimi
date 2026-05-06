# Desktop

桌面端是 Nimi 的第一方原生外壳。它可以承载网页端不能安全暗示的能力：原生 Runtime 集成、本地能力面、Mod 面、窗口行为，以及外壳特定的工作流。

本章节解释桌面端面板、网页端与它的差别，以及桌面端 Mod 如何被治理。

## 本章节包含

- [网页端模式](/zh/desktop/web-mode) — 桌面端选定面板在浏览器中的受限版。
- [Mod](/zh/desktop/mods) — 桌面端的有界扩展模型与 Hook 能力边界。

## 桌面端与网页端不一样

Nimi 同时有桌面端和网页端面板，但它们的能力范围不一样。网页端是受限版；桌面端在合同允许时可以承载原生与本地行为。

| 能力领域 | 桌面端 | 网页端 |
| --- | --- | --- |
| 原生 Runtime 启动 | 可用 | 关闭 |
| 本地 AI 能力面 | 合同认可时可用 | 关闭 |
| Mod 注册与运行 | 可用 | 关闭 |
| 原生窗口与外壳行为 | 可用 | 关闭 |
| 敏感令牌持久化 | 原生安全 | 受限 |
| 公开产品读（浏览、聊天、世界视图） | 可用 | 经认可作为受限版可用 |

这一区分对公开文档很重要。一个网页端页面**不应**因为概念相同就暗示桌面端原生能力。表面上看起来宿主无关的代码，底下可能依赖桌面端独有的合同。

## 桌面端拥有什么

桌面端拥有外壳行为、原生桥接、Mod 治理面、窗口与菜单行为、本地集成边界，以及第一方用户工作流。它**消费** Runtime 与 SDK 合同，而不是替代它们。

## 阅读场景：安装一个使用本地能力的 Mod

设想桌面端用户想安装一个使用本地 AI 能力的 Mod：

1. 用户走桌面端 Mod 治理面板。Mod 在 mod-governance 合同下有定义好的生命周期（admitted、installed、active、suspended）。
2. Mod 声明它需要哪些 Hook 能力。每个 Hook 能力来自允许列表；任意能力不会被授予。
3. Mod 通过 `sdk/mod` 与桌面端 Hook 面消费 Runtime 能力。即使在本地运行，它也不会绕过 Runtime 合同。
4. 如果设备特征或本地能力注册表不准入这条本地路由，Mod 收到的是有类型的拒绝，不是默认 fallback。

同样的流程在网页端**不会发生**。Web 适配器关闭原生 Runtime 启动和 Mod 注册；同一个 Mod 不能未经修改在浏览器里跑。

## 阅读场景：「两端都可用」的面板

设想某个公开读面板（例如浏览世界）在桌面端与网页端都被认可。即便如此：

- 桌面端把面板渲染在原生外壳里，配原生导航与（合同认可时的）本地增强。
- 网页端把面板渲染在浏览器里，没有原生启动、没有 Mod 面，敏感令牌持久化也只能用浏览器允许的安全方式。

读者在做分发决策时需要明白：「两端都可用」不等于「两端完全一样」。

## 来源

- [`.nimi/spec/desktop/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/index.md)
- [`.nimi/spec/desktop/kernel/ui-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/ui-shell-contract.md)
- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/hook-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/hook-capability-contract.md)
- [`.nimi/spec/desktop/kernel/bootstrap-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/bootstrap-contract.md)
- [`.nimi/spec/desktop/kernel/bridge-ipc-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/bridge-ipc-contract.md)
- [`.nimi/spec/desktop/web-adapter.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/web-adapter.md)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml)
- [`.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml)
