# 外部 Agent

> 状态：身份模型已准入；当前没有公开生产 action plane。`ExternalPrincipal` 身份模型存在，但可用的 Token 签发与动作执行必须由 Runtime-owned gateway/action registry 暴露。

Nimi 将外部 AI 宿主（独立 AI provider、带 MCP 工具的 Agent、未来 A2A peer）建模为 `ExternalPrincipal` 参与者。这个身份属于授权模型的一部分，但不表示当前产品构建已经交付可用的外部 Agent action plane。

桌面端入口见 [桌面端 → 外部 Agent 接入](/zh/desktop/external-agent)。

## `ExternalPrincipal` 是什么

`ExternalPrincipal` 是为外部 AI 宿主预留的强类型身份。它不同于用户、第一方 App 和内部 Agent。

| 维度 | 当前边界 |
| --- | --- |
| 身份 | 平台准入的 `ExternalPrincipal` |
| Token 签发 | 当前没有公开生产接口；必须由 Runtime 持有 gateway/server 后暴露 |
| Action descriptors | Runtime-owned，不在 renderer 或 Desktop 本地定义 |
| Token ledger | Runtime-owned |
| Action surface | Runtime-owned action plane |
| Desktop 角色 | UI 位置与用户控件 |
| SDK 角色 | 强类型投影 |

Runtime action registry 为空时，当前产品必须失败关闭。Desktop 面板或 SDK 方法可以暴露禁用状态，但不能合成可用 Token 或本地 action descriptor。

## 未来能力域

当 Runtime 准入 action registry 后，Token 作用域会由强类型能力域定义：

| 能力域 | 覆盖范围 |
| --- | --- |
| `action.discover.*` | 只读发现 |
| `action.dry-run.*` | 不修改的模拟 |
| `action.verify.*` | 不修改的验证 |
| `action.commit.*` | 经策略准入的修改 |

Token 只能携带显式域。平台拒绝“什么都能做”的环境型权限。

## 委派会话边界

外部 principal 不会直接修改产品真相。Runtime 打开委派会话，通过输出防火墙评估结果，并且只在策略准入后发出 Runtime-owned action。

| Runtime 关注点 | 边界 |
| --- | --- |
| Descriptor registry | Runtime 真相 |
| Output firewall | Runtime 真相 |
| Approval 与 quarantine | Runtime 真相 |
| Audit replay | Runtime 真相 |
| 用户可见位置 | 通过 SDK 投影到 Desktop |

这能防止未来外部 AI 集成变成 Desktop 捷径或 SDK 私有旁路。

## 场景：当前构建

1. **用户打开 External Agent Access。** Desktop 向 Runtime 查询状态。
2. **Runtime 返回禁用。** 原因是 `EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY`。
3. **Desktop 显示原因。** Token 签发保持禁用。
4. **没有动作发生。** 没有合成 Token、本地 action descriptor 或 renderer fallback。

在 Runtime 能力落地前，这就是正确行为。

## 来源依据

- [`.nimi/spec/platform/kernel/ai-last-mile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-last-mile-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-approval-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-approval-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md)
