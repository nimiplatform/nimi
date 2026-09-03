# 外部 Agent 接入

> 状态：暂未开放。桌面端在 Runtime Config 里为 External Agent Access 保留了位置，但在 Runtime 的网关与 action plane 就绪之前，Token 签发保持关闭。

External Agent Access 是为未来能力预留的设置区：管理 `ExternalPrincipal`，也就是让外部 AI 工具带着限定范围的 Token 连进 Nimi。当前版本可以显示 Runtime 状态和一个空的 Token 账本，但你今天还签不出可用的 Token。

平台模型见 [平台 → Agent → 外部 Agent](/zh/platform/agents/external-agents)。

## 当前行为

| 状态 | 行为 |
| --- | --- |
| Runtime 投影可用 | 桌面端可以读取 Runtime 的 External Agent 状态投影 |
| Action registry 为空 | Token 签发保持禁用，原因是 `EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY` |
| Token 账本 | 在 Runtime 准入 action registry 与 gateway server 前保持为空 |
| 签发 / 撤销 | 当前构建不是已交付的用户工作流 |

这块面板是有意锁住的。光启动 Runtime daemon 还不够；Runtime 必须先提供 action descriptor registry、gateway server、token ledger 和审计记录，这项能力才能用。

## 为什么仍然可见

保留这个区域，是给未来的能力一个固定的家，也让你能看到它当前不可用的确切原因。把原因摆出来，不等于 Token 签发已经上线。

你永远不会从这块面板看到：

- 不声不响的「成功」，
- 凭空造出来的 Token，
- 桌面端本地的 Token 账本，
- 藏在 renderer 或 Tauri 里的备用 action registry。

## 未来能力边界

能力上线后，它的核心部件都在 Runtime：

| 关注点 | Owner |
| --- | --- |
| Action descriptors | Runtime |
| Gateway/server | Runtime |
| Token ledger | Runtime |
| Audit lineage | Runtime |
| UI 位置与控件 | Desktop |
| 强类型投影 | SDK |

桌面端仍是你管理它的入口，但 action 与 Token 本身都归 Runtime。

## 来源依据

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
