# 桌面端

桌面端是 Nimi 的第一方原生外壳。它承载网页端无法安全交付的能力：原生 Runtime 接入、本地 AI 能力、原生窗口行为，以及需要真实操作系统支撑的工作流。

本节说明桌面端覆盖什么、网页端为何不同，以及原生能力如何保持在 Runtime/SDK 边界内。

## 本节包含的内容

- [Web 模式](/zh/desktop/web-mode) — 桌面端部分能力在浏览器中的受限呈现。

## 桌面端与网页端不一样

Nimi 同时存在桌面端与网页端，但二者的能力范围并不对等。网页端是受限的呈现层，桌面端在契约准入下承载原生与本地行为。

| 能力域 | 桌面端 | 网页端 |
| --- | --- | --- |
| 原生 Runtime 启动 | 可用 | 不可用 |
| 本地 AI 能力面 | 准入后可用 | 不可用 |
| 原生窗口与外壳行为 | 可用 | 不可用 |
| 敏感令牌持久化 | 系统级安全存储 | 受限 |
| 公共读取（浏览、聊天、世界视图） | 可用 | 准入后可用 |

这点对公开文档很重要：网页端某个页面不能仅因业务概念相同，就让读者以为它具备桌面原生能力。表层宿主无关的代码，底层仍可能依赖只有桌面端才有的契约。

## 桌面端拥有的范围

桌面端拥有外壳行为、原生桥接、窗口与菜单、本地集成边界，以及第一方用户工作流。它消费 Runtime 与 SDK 契约，不替代它们。

## 场景：双端都在的页面

假设某个公开读取页面（比如浏览一个世界）在桌面端与网页端都准入：

- 桌面端在原生外壳里渲染，使用原生导航；准入时启用本地增强。
- 网页端在浏览器里渲染，没有原生启动，敏感令牌只能落在浏览器允许的范围。

读者在做分发判断时需要明白一件事：双端都在不等于双端一致。

## 来源依据

- [`docs/spec/desktop-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/desktop-domain-index.md)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
- [`.nimi/spec/desktop/shell-runtime.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-runtime.authority.yaml)
- [`.nimi/spec/desktop/bridge-ipc.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/bridge-ipc.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
