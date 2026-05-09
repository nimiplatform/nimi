# 桌面端

桌面端是 Nimi 的第一方原生外壳。它承载网页端无法安全交付的能力：原生 Runtime 接入、本地 AI 能力、Mod 体系、原生窗口行为，以及需要真实操作系统支撑的工作流。

本节说明桌面端覆盖什么、网页端为何不同，以及桌面端 Mod 如何治理。

## 本节包含的内容

- [Web 模式](/zh/desktop/web-mode) — 桌面端部分能力在浏览器中的受限呈现。
- [Mod 体系](/zh/desktop/mods) — 桌面端的有界扩展模型与 hook 能力边界。

## 桌面端与网页端不一样

Nimi 同时存在桌面端与网页端，但二者的能力范围并不对等。网页端是受限的呈现层，桌面端在契约准入下承载原生与本地行为。

| 能力域 | 桌面端 | 网页端 |
| --- | --- | --- |
| 原生 Runtime 启动 | 可用 | 不可用 |
| 本地 AI 能力面 | 准入后可用 | 不可用 |
| Mod 注册与运行 | 可用 | 不可用 |
| 原生窗口与外壳行为 | 可用 | 不可用 |
| 敏感令牌持久化 | 系统级安全存储 | 受限 |
| 公共读取（浏览、聊天、世界视图） | 可用 | 准入后可用 |

这点对公开文档很重要：网页端某个页面不能仅因业务概念相同，就让读者以为它具备桌面原生能力。表层宿主无关的代码，底层仍可能依赖只有桌面端才有的契约。

## 桌面端拥有的范围

桌面端拥有外壳行为、原生桥接、Mod 治理面、窗口与菜单、本地集成边界，以及第一方用户工作流。它消费 Runtime 与 SDK 契约，不替代它们。

## 场景：安装一个使用本地能力的 Mod

某用户想在桌面端安装一个调用本地 AI 能力的 Mod。

1. **进入 Mod 治理面**。Mod 走治理契约定义的生命周期：admitted、installed、active、suspended。
2. **声明 hook 能力需求**。Mod 申报需要的 hook 能力；每一项必须出自白名单，任意能力不会被授予。
3. **走 SDK 通道**。Mod 通过 `sdk/mod` 与桌面端 hook 面消费 Runtime 能力。即使在本地运行，也不能绕开 Runtime 契约。
4. **本地能力被拒**。如果设备画像或本地能力注册表不准入它请求的本地路径，Mod 收到强类型拒绝，没有静默退化。

同样的流程在网页端不会发生。Web 适配器关闭了原生 Runtime 启动与 Mod 注册，未经改写的 Mod 在浏览器里跑不起来。

## 场景：双端都在的页面

假设某个公开读取页面（比如浏览一个世界）在桌面端与网页端都准入：

- 桌面端在原生外壳里渲染，使用原生导航；准入时启用本地增强。
- 网页端在浏览器里渲染，没有原生启动、没有 Mod 面，敏感令牌只能落在浏览器允许的范围。

读者在做分发判断时需要明白一件事：双端都在不等于双端一致。

## 来源依据

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
