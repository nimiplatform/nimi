# 架构不变量与常见误区对照（Architecture Invariants & Anti-Patterns）

在开发 Nimi 应用或集成平台能力时，理解系统的真实能力边界与架构不变量至关重要。本文档列举了集成过程中的常见认知误区，并指明正确的验证方式。

## 常见误区与正规验证路径

| 常见误解 | 实际架构逻辑与正确验证方式 |
| --- | --- |
| **误以为模型权重文件下载完毕，AI 即可直接调用** | 模型文件仅为磁盘静态资源；需将其配置为 Loadout 并设为能力默认项，且当前宿主硬件驱动与环境就绪后方可正常执行。 |
| **误以为连接了某个云服务商，便支持所有模型与动作** | 具体的接口支持度取决于该 Connector 在当前 Runtime 中已实现的驱动方言（Driver）与功能矩阵。 |
| **误以为异步任务推送完成事件，结果就已经持久化** | 事件流主要用于界面即时进度反馈；对于正式的项目数据，应用应通过最终的 `Get` 接口读取完整数据并转存至应用私有目录。 |
| **误以为本地开发模式可以直接免除所有安全校验** | 本地开发模式（Developer Mode）仅方便本地调试与自签名测试，核心会话签名与权限校验依然严格生效。 |
| **误以为切换不同应用会自动共享所有私有记忆** | 每个 LocalAgent 拥有独立的私有认知沙箱，记忆仅在同一个经过授权的 LocalAgent 会话流中按需召回。 |
| **误以为只要依赖了 SDK 就能访问内部未开放接口** | 平台严格实行接口可见性隔离，仅通过公开导出的符号对外提供能力，内部底层协议受到沙箱保护。 |

## 结构化状态码的行动指南

当遇到系统返回非成功状态（如 `unavailable`, `permission-required`, `blocked`）时：
- **如实呈现**：建议前端直接呈现结构化状态码背后的明确原因，指导用户完成具体配置（如提示启动服务、请求授权）；
- **避免静默容错**：避免在未通知用户的情况下私自降级为无关模型或伪造成功假象，确保系统交互的高确定性与可信度。

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
