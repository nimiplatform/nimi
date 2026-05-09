# 六大基础协议

平台六大固定基础协议参考。权威契约：`.nimi/spec/platform/protocol.md`，规则族 `P-PROTO-*`。

## 六项基础协议

| 基础协议 | 规则 | 承载 |
| --- | --- | --- |
| Timeflow | `P-PROTO-100` | 推进、时序、时间含义 |
| Social | `P-PROTO-101` | 关系、社交图语义 |
| Economy | `P-PROTO-102` | 价值、交换、经济状态 |
| Transit | `P-PROTO-103` | 跨世界或跨语境的移动 |
| Context | `P-PROTO-104` | 共享情境含义 |
| Presence | `P-PROTO-105` | 在场的是谁、以何种条件 |

每一项都是一个契约面。世界可以定义自己的内部规则；跨世界的语义必须落进这六个契约之一。

## 权威

| 层 | 角色 |
| --- | --- |
| 平台协议 | 定义基础协议形态与版本策略 |
| Realm | 持有六大基础协议的真相源与语义执行 |
| App | 使用与观察；不执行 |

`P-PROTO-003` 把基础协议的语义执行与真相源固定在 Realm。

## 跨基础协议一致性

涉及多项基础协议的世界状态变化必须同时满足所有相关契约：

| 约束 | 原因 |
| --- | --- |
| 一次 transit 必须同时满足 Social + Economy + Context | transit 让参与者跨世界移动；社交位次、经济位次、语境含义必须三者对齐 |
| Presence 不能绕过社交准入 | 在一个世界 "在场" 必须先通过社交准入 |
| Timeflow 不能打破经济结算窗口 | 时间推进必须尊重经济结算边界 |

六项基础协议不是相互独立的枚举，而是相互约束。

## 版本策略

| 属性 | 值 |
| --- | --- |
| 策略 | `strict-only` |
| 跨小版本握手 | 禁止 |
| 向后兼容 shim | 禁止 |
| 失败模式 | 契约违例 fail-close |

客户端必须严格匹配。不存在违反契约却假装兼容的优雅降级。

## 授权预设

App 在受限作用域下与基础协议交互。平台准入三套预设模板，token 形态与校验链一致：

| 预设 | 读 | 写 | 委派 |
| --- | --- | --- | --- |
| `readOnly` | 是 | 否 | 否 |
| `full` | 是 | 是 | 否 |
| `delegate` | 是 | 是 | 一层 |

`delegate` 默认允许向下再委派一层。

## App 模式

| 模式 | 基础协议读 | 基础协议写 | 单世界活跃数 |
| --- | --- | --- | --- |
| `render-app` | 是 | 否 | 多个 |
| `extension-app` | 是 | 是 | 单世界至多一个活跃 |

## 审计事件

跨基础协议的动作会产出审计事件，记录在平台审计字典：`.nimi/spec/platform/kernel/tables/audit-events.yaml`。

## Source Basis

- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-primitives.yaml)
- [`.nimi/spec/platform/kernel/tables/protocol-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-error-codes.yaml)
- [`.nimi/spec/platform/kernel/tables/audit-events.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/audit-events.yaml)
- [`.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml)
- [`.nimi/spec/platform/kernel/tables/participant-profiles.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/participant-profiles.yaml)
- [`.nimi/spec/realm/kernel/transit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/transit-contract.md)
- [`.nimi/spec/realm/kernel/social-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/social-contract.md)
- [`.nimi/spec/realm/kernel/economy-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/economy-contract.md)
