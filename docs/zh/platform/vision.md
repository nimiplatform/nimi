<!-- nimi-docs: {"authority":["rule.nimi.platform.core-protocol.p-arch-001a","rule.nimi.platform.governance-release.p-gov-026-positioning"],"sources":["VISION.md"]} -->

# 全终端 AI 愿景

Nimi 的方向是为移动端、Web、PC、嵌入式设备和智能家居提供用户可控的 AI 基础设施。应用可以专注真实任务，终端可以提供合适的交互，AI 能力与有权限访问的状态通过共同合同连接起来。

## 从今天的主 Runtime 出发

当前 PC Runtime 执行本地与云端 AI。Desktop App 使用本机受保护 Host；获准的 Web、Android 来源通过官方登录和 Home 确认，直接连接账号绑定的主 Runtime。手机或浏览器不必运行自己的 Runtime。Nimi Home 目前由 Desktop 承载，负责本机入口与管理。

例如，用户可在另一块屏幕继续同一伙伴的 Conversation；创作 App 可以从浏览器提交任务并查询主机保存的结果。这些路径消费同一主机的状态，不代表跨 Runtime 同步，也不授予其他 App 私有数据的访问权。

## 能力与数据仍由各自 owner 管理

用户选择 Local 或 Cloud。Local 在 Runtime 主机执行；Cloud 会将本次所需上下文发送给所选服务商。Realm 管理生态身份与共享资源，Runtime 管理执行、Conversation 和访问，Cognition 管理按 Agent 隔离的长期记忆。App 保留自身业务流程与私有数据，Avatar 负责呈现。Knowledge V1 尚无公共读写入口。

## 向更多设备延伸

嵌入式和智能家居终端可能提供输入、输出或实际动作；更多移动平台需要自己的正式载体。每种终端都需明确角色、权限、状态归属、资源限制和失联行为，再形成可交付路径。角色陪伴、世界体验、日常工具与创作均属于这套基础设施的应用方向。

当前远程接入不提供中继兜底；Android 源码开发不等于正式 App Link 分发已验收。后续网络覆盖、额外 Runtime 主机和算力联邦分别演进，具体范围见[路线图](/zh/platform/roadmap)与[接入指南](/zh/start/)。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
