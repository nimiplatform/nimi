# 外部 Agent 接入

> 状态：契约说明；当前没有公开生产 action plane。桌面端保留 Runtime Config 中的 External Agent Access 位置，但在 Runtime-owned gateway/action plane 暴露前，Token 签发与 action registry 必须失败关闭。

External Agent Access 是为未来 `ExternalPrincipal` 管理预留的桌面端表面。当前产品构建可以展示 Runtime 状态和空账本投影，但不能暗示外部 AI 宿主现在已经能拿到可用的限定作用域 Token。

平台模型见 [平台 → Agent → 外部 Agent](/zh/platform/agents/external-agents)。

## 当前行为

| 状态 | 行为 |
| --- | --- |
| Runtime 投影可用 | 桌面端可以读取 Runtime 的 External Agent 状态投影 |
| Action registry 为空 | Token 签发保持禁用，原因是 `EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY` |
| Token 账本 | 在 Runtime 准入 action registry 与 gateway server 前保持为空 |
| 签发 / 撤销 | 当前构建不是已交付的用户工作流 |

这块面板是有意失败关闭的。启动 Runtime daemon 并不足以让 External Agent Access 可用；Runtime 必须先持有 action descriptor registry、gateway server、token ledger 与审计血缘。

## 为什么仍然可见

桌面端保留这个位置，是为了给未来能力一个稳定入口，并让 Runtime 能投影明确的禁用原因。这不同于交付 Token 签发能力。

面板必须清楚表达禁用原因：

- 没有静默成功，
- 没有合成 Token，
- 没有 Desktop-local token ledger，
- 没有 renderer 或 Tauri 里的备用 action registry。

## 未来能力边界

能力准入后，External Agent Access 由 Runtime 持有：

| 关注点 | Owner |
| --- | --- |
| Action descriptors | Runtime |
| Gateway/server | Runtime |
| Token ledger | Runtime |
| Audit lineage | Runtime |
| UI 位置与控件 | Desktop |
| 强类型投影 | SDK |

桌面端仍是用户可见位置，但不持有 action 权威或 token 真相。

## 来源依据

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
