# 网页端模式

网页端模式是 Nimi 的受限版本。它能在浏览器里呈现选定的平台与产品面，但**不**继承桌面端原生的 runtime、本地、mod、窗口、外壳能力。

支撑网页端行为的 kernel 规则在网页端发布合同与桌面端 web adapter 下。

## 网页端被禁用了什么

Web adapter 禁用依赖桌面端或 Tauri 类能力的面：

- 原生 runtime bootstrap。
- Mod 注册与进程内 hook runtime。
- 依赖原生进程的外部 Agent 桥。
- 原生窗口管理与 OS 集成。
- 浏览器无法安全提供的敏感 token 持久化。

这些约束不是任意决定。每一条都对应浏览器在不削弱用户安全或内容完整性的前提下满足不了的合同。

## 网页端还能做什么

网页端能呈现在受限版本下安全的准入面：

- 解释平台、把用户引到公开文档、托管被准入为浏览器安全的产品面。
- 呈现合同被准入为 web-safe 的读向体验。
- 提供回到桌面端外壳的入口，给需要完整能力的用户。

网页端的角色是**真实的一个面**，但有意比桌面端小。

## 阅读场景：只在桌面端可用的能力

某用户跟一条公开链接进了浏览器里的 Nimi 页面，页面引用了一个依赖原生 runtime 能力的功能。Web adapter **不会**静默回退到一个降级版。合同下的预期行为是：

- 浏览器面解释这个功能需要桌面端。
- 不暗示有原生 bootstrap。
- 不让用户误以为浏览器在跑那个功能。

这种诚实很重要。静默回退会就系统的实际姿态撒谎。

## 阅读场景：Mod 作者想问网页端

某 mod 作者想自己的 mod 跑在网页端「为了覆盖更多用户」。在 Web adapter 下，**mod 不是网页端面的一部分**。作者有两个真实选项：

- 写桌面端 mod，接受这个面只在桌面端。
- 提一个非 mod 面（比如某种内容读模式），可被准入为 web-safe 版本。

网页端**不会**意外变成一个小一号的 mod runtime。如果某项能力在网页端被准入，那是显式的合同变更。

## 来源

- [`.nimi/spec/desktop/web-adapter.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/web-adapter.md)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/desktop/kernel/ui-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/ui-shell-contract.md)
- [`.nimi/spec/desktop/kernel/bootstrap-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/bootstrap-contract.md)
