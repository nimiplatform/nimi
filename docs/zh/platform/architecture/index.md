<!-- nimi-docs: {"authority":["rule.nimi.platform.core-protocol.p-arch-001a","rule.nimi.sdks.client-core.remote-runtime-carrier","rule.nimi.platform.core-protocol.p-arch-002","rule.nimi.platform.core-protocol.p-arch-020"],"sources":["sdks/typescript/runtime/remote.ts","runtime/internal/grpcserver/remote_transport.go"]} -->

# 系统架构总览

Nimi 围绕平级对等的架构域（Sibling Domains）组织，各域之间通过类型化投影进行连接。

```text
Desktop App ── 原生 Host ──┐
Web / Android ── WebRTC ─────┼── PC Runtime ── 本地 / 云端 AI
Nimi Home ── 宿主管理 ───┘       │
                                    └── Cognition（长期记忆）
Realm: 身份、资源、主 Runtime 绑定与连接协调
```

Realm 与 Runtime 彼此保持解耦的平级对等关系：Runtime 绝不会演变为 Realm 的内部子系统，Realm 也不会介入本地推理执行。SDK 是面向消费方的接口契约，而非拥有独立裁量权的第三方管理机构。

Nimi Home 承载活跃的桌面应用环境，组合调用公共 SDK 操作与按需加载的 Kit UI 组件。通过脚手架构建的应用程序仅基于受保护会话获取操作权限，无法越权访问特权密钥或底层 Runtime 内部凭据。

Avatar 系统依据结构化呈现流渲染具身形象，独立管理视线与动作等渲染器局部状态，不干预 Runtime 的执行状态或 Realm 的身份资产。

## 核心架构原则

- **身份与世界数据归属 Realm**：角色持久身份定义（Character Identity）与数字世界权威历史始终保存在 Realm 中。
- **运行态与执行归属 Runtime**：LocalAgent 生命周期管理、实时会话、模型调度与应用鉴权统一由 Runtime 管控。
- **长期记忆由 Cognition 隔离存储**：智能体私有长期记忆由 Cognition 负责存储与维护，Runtime 提供受控的调解通道；Knowledge V1 暂未开放公共接口。
- **应用专注交互与本地状态**：应用程序通过公共 SDK 接口发起调用，仅管理自身交互与产品私有数据。
- **桌面宿主保持解耦**：桌面客户端是首要的第一方宿主，而非不可替代的平台权威。
- **安全由声明式目标约束**：平台安全以不变的规范要求为准；底层操作系统特定的隔离机制属于各子系统的内部实现细节，除非有正式契约约定，否则不对外暴露。
- **非阻塞架构**：远期规划项绝不阻塞当前本地产品的生命周期。

当前 PC Runtime 是执行主机。Desktop App 通过本机受保护会话接入；获准的 Web 和 Android App 通过公共 SDK 直连账号绑定的主 Runtime，无需在消费设备上安装 Runtime。远程来源先完成官方登录、来源准入和 Home 确认；只有载体已实现且权限允许的操作可用。详见[本地与远程接入](/zh/platform/architecture/local-first-with-federation)。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`.nimi/spec/platform/remote-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/remote-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
