# 桌面端

桌面端是 Nimi 自家的原生应用，装在你的电脑上。它能做到浏览器版本做不到的事：内置 Runtime、本地 AI、真正的窗口和菜单，以及需要真实操作系统配合的工作流。

这一节介绍桌面端里能做什么、网页端和它差在哪，以及各项功能的数据存在哪里。

## 本节包含的内容

- [Web 模式](/zh/desktop/web-mode) — 在浏览器里使用桌面端的部分能力，范围更小。

## 桌面端与网页端不一样

Nimi 既有桌面端也有网页端，但两者能做的事不一样多。网页端是有意做小的版本，原生和本地的能力都在桌面端。

| 能力域 | 桌面端 | 网页端 |
| --- | --- | --- |
| 原生 Runtime 启动 | 可用 | 不可用 |
| 本地 AI 能力面 | 准入后可用 | 不可用 |
| 原生窗口与外壳行为 | 可用 | 不可用 |
| 敏感令牌持久化 | 系统级安全存储 | 受限 |
| 公共读取（浏览、聊天、世界视图） | 可用 | 准入后可用 |

选择在哪里使用 Nimi 时，记住这一点：浏览器里能打开的页面，不一定带桌面端才有的能力，哪怕两边看起来一样。

## 桌面端拥有的范围

桌面端负责外壳本身：窗口、菜单、原生桥接、本地集成，以及你日常使用的第一方工作流。它建立在 Runtime 和 SDK 的契约之上，而不是另起一套。

## 读者场景：双端都在的页面

假设某个公开读取页面（比如浏览一个世界）在桌面端与网页端都准入：

- 桌面端在原生外壳里渲染，使用原生导航；准入时启用本地增强。
- 网页端在浏览器里渲染，没有原生启动，敏感令牌只能落在浏览器允许的范围。

读者在做分发判断时需要明白一件事：双端都在不等于双端一致。

## 来源依据

- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
- [`.nimi/spec/desktop/shell-runtime.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-runtime.authority.yaml)
- [`.nimi/spec/desktop/bridge-ipc.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/bridge-ipc.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
