# 网页端模式

网页端把 Nimi 的一部分能力带进了浏览器。桌面端独有的部分不在其中：原生 Runtime、本地能力、原生窗口和外壳集成。

网页端能做什么、不能做什么，由 Web 发布契约和桌面端的 Web 适配器规定。

## 网页端关闭的能力

Web 适配器会关掉依赖桌面端或 Tauri 类能力的界面：

- 原生 Runtime 启动。
- 依赖原生进程的外部 Agent 桥。
- 原生窗口管理与系统集成。
- 超出浏览器安全能力的敏感令牌持久化。

这些限制不是随意定的。每一条都对应一个浏览器达不到的标准：要么关乎你的安全，要么关乎内容完整性。

## 网页端仍然能做的事

在受限的浏览器环境里，网页端依然好用：

- 介绍平台、带你翻阅公开文档，并承载已确认可在浏览器中使用的产品界面。
- 提供以查看为主的体验，前提是这些体验已确认在浏览器中安全。
- 在你需要完整能力时，指引你回到桌面端。

网页端是 Nimi 真实的一端，只是有意比桌面端小。

## 读者场景：某项能力只在桌面端可用

某用户在浏览器打开一份 Nimi 的公开链接，页面引用了一项依赖原生 Runtime 的能力。Web 适配器不会偷偷退化为弱化版。契约下的预期行为是：

- 浏览器面明确说明此能力需要桌面端。
- 不会让用户误以为可以原生启动。
- 不让用户误以为浏览器在跑这项能力。

这种诚实是有意义的。一次静默退化就等于在系统姿态上撒谎。

## 来源依据

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
- [`.nimi/spec/desktop/shell-runtime.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-runtime.authority.yaml)
