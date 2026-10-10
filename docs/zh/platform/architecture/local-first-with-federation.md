# 本地优先与多设备

Nimi 可以使用已配置的本地能力在你的机器上执行 AI，也可以使用你明确配置的云端能力。本地优先不表示匿名或无限制离线运行：Nimi 需要账号，受保护访问和当前授权仍然适用。

## 本地执行

准备资源和环境，保存并选择能力对应的机器 Loadout，再在 App 或共享 LocalAgent AIConfig 中保存 Local 意图。提交时 Runtime 固定这份确切配置，请求失败不会自动在 Local 和 Cloud 之间切换。

Cognition 通过 Runtime 强类型桥接在本地保存各 Agent 的长期 Memory。Memory 开关按 Agent 独立管理；Knowledge V1 没有活动导入或查询路径。Conversation 与本地审计分别由 Runtime 保存。

## 网络不可用时

已有本地工作只有在必要的受保护会话、权限、资源和 owner 策略有效时才能继续。冷启动、新登录、获取 Realm 来源、续期授权或云端调用都可能需要联网。本地缓存不能制造账号或 Realm 操作成功。

世界、身份、社交和经济真相归 Realm。待提交的本地意图不是已完成的 Realm 变更。本地操作不意味着审计自动上传或 Memory 跨设备同步。

## 多设备与联邦

每台设备有自己的 Runtime 和本地配置。经 Realm 共享账号或 Character 身份，不会自动共享 Loadout、Conversation 状态或 Agent Memory。

点对点算力联邦是未来方向，不是当前传输或安装步骤。不能把 App 指向另一台机器的私有 Runtime 端点来模拟；只使用当前产品准入的受保护宿主与操作。

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
