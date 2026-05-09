# 网页端模式

网页端模式是 Nimi 的受限呈现。它能在浏览器里展示选定的平台与产品面，但不继承桌面端原生的 Runtime、本地、Mod、窗口、外壳能力。

这一页背后的内核规则归在 Web 发布契约和桌面端的 Web 适配器中。

## 网页端关闭的能力

Web 适配器关闭的，是那些依赖桌面端或 Tauri 类能力的面：

- 原生 Runtime 启动。
- Mod 注册以及进程内 Hook 运行环境。
- 依赖原生进程的外部 Agent 桥。
- 原生窗口管理与系统集成。
- 浏览器无法安全提供的敏感令牌持久化。

这些限制不是任意的。每一项都对应一份浏览器无法在不削弱用户安全或内容完整性的前提下满足的契约。

## 网页端仍然能做的事

网页端仍然能呈现那些在受限环境下安全的准入面：

- 介绍平台、把用户引向公开文档、承载浏览器安全的产品面（前提是这些面已被准入）。
- 呈现以读取为主的体验，前提是它们的契约已被准入为 web-safe。
- 提供回到桌面端外壳的入口，给需要完整能力的用户。

网页端是一面真实的 surface，只是有意被做得比桌面端更小。

## 场景：某项能力只在桌面端可用

某用户在浏览器打开一份 Nimi 的公开链接，页面引用了一项依赖原生 Runtime 的能力。Web 适配器不会偷偷退化为弱化版。契约下的预期行为是：

- 浏览器面明确说明此能力需要桌面端。
- 不会让用户误以为可以原生启动。
- 不让用户误以为浏览器在跑这项能力。

这种诚实是有意义的。一次静默退化就等于在系统姿态上撒谎。

## 场景：Mod 作者想覆盖网页端

某 Mod 作者想让 Mod 在网页端跑「拓宽覆盖面」。在 Web 适配器下，Mod 不属于网页端。作者有两个真实选项：

- 写桌面端 Mod，接受这一面只在桌面端运行。
- 提议一个非 Mod 的面（比如某种内容读取模式），让它有机会被准入为 web-safe 呈现。

网页端不会因为顺手就变成一个小一号的 Mod 运行环境。某项能力被准入到网页端，只能是显式契约变更。

## 来源依据

- [`.nimi/spec/desktop/web-adapter.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/web-adapter.md)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/desktop/kernel/ui-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/ui-shell-contract.md)
- [`.nimi/spec/desktop/kernel/bootstrap-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/bootstrap-contract.md)
