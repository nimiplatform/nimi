<!-- nimi-docs: {"authority":["rule.nimi.platform.core-protocol.p-arch-001a","rule.nimi.platform.governance-release.p-gov-026-positioning"],"sources":["VISION.md"]} -->

# 全终端 AI 愿景

人们每天在不同屏幕与工具之间切换，但 AI 能力和个人上下文往往被困在孤立的应用里。Nimi 致力于构建一套由用户掌控的全终端 AI 基础设施，连接 PC、Web、移动端、嵌入式设备与智能家居。通过共同接口与访问规则，应用只需专注解决真实问题，终端各自提供最合适的交互，而模型调用与授权状态则在底层顺畅衔接。

## 今天如何使用：从 PC 主 Runtime 出发

目前，PC Runtime 是本地与云端 AI 的执行核心，由 Desktop 承载的 Nimi Home 则提供本机入口与日常管理。原生 Desktop App 通过受保护的本机 Host 会话接入；获准的 Web 与 Android 来源在完成官方登录并经 Home 确认后，也能直接连接账号绑定的主 Runtime——手机或浏览器无需自己运行一套 Runtime。

这意味着你可以在另一块屏幕上继续与同一位伙伴的 Conversation，或者在浏览器里通过创作 App 提交任务、随时查看主机保留的生成结果。这些体验访问的是同一台主机上已获授权的数据，并不代表跨 Runtime 自动同步，也不会让某个 App 越界访问其他 App 的私有数据。（当前远程接入采用直连方式，暂不提供中继兜底；Android 已有本机开发入口，正式分发仍需按 App Link 路径单独验证。）

## 明确的能力与数据归属

你可以自由选择 AI 的运行路径：选择 Local 会在 Runtime 主机本机执行；选择 Cloud 则仅将当次请求所需的上下文发送给所选服务商。在系统内部，不同系统分别管理各自负责的能力与数据，互不越界：

- **Realm**：管理生态身份与共享资源。
- **Runtime**：管理能力执行、Conversation 与访问控制。
- **Cognition**：管理按 Agent 隔离的长期记忆（Knowledge V1 目前尚无公共读写入口）。
- **App**：保留各自的业务流程与私有数据。
- **Avatar**：负责角色与视觉呈现。

## 未来走向：延伸到更多日常终端

在桌面、浏览器与手机之外，Nimi 希望进一步延伸至更多移动平台、嵌入式设备与智能家居终端——无论是负责感知与交互的轻量入口，还是能够执行实际动作的硬件设备。角色陪伴、共享世界、日常效率工具与专业创作，都是生长在这套基础设施之上的应用体验。

这些新终端载体、更广域的网络覆盖、额外 Runtime 主机以及算力联邦属于未来的演进方向，目前尚未提供。每一类新终端在成为正式可交付路径前，都会围绕真实用户任务明确界定其角色、权限、状态归属、资源限制与失联行为。关于当前支持范围与后续规划，请参阅[路线图](/zh/platform/roadmap)与[接入指南](/zh/start/)。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
