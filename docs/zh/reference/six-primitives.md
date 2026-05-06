# 六个基础协议

六个固定协议基础协议的参考表。权威合同：`.nimi/spec/platform/protocol.md` 与规则家族 `P-PROTO-*`。

## 六个

| 基础协议 | 规则 | 装载 |
| --- | --- | --- |
| Timeflow | `P-PROTO-100` | 进展、计时、时间含义 |
| Social | `P-PROTO-101` | 关系、社交图语义 |
| Economy | `P-PROTO-102` | 价值、交换、经济状态 |
| Transit | `P-PROTO-103` | 在世界或上下文之间移动 |
| Context | `P-PROTO-104` | 共享情境含义 |
| Presence | `P-PROTO-105` | 谁或什么在场、在什么条件下 |

每个基础协议是一个合同面。世界可以定义自己内部规则；跨世界含义必须 fit 这六个合同之一。

## 权威

| 层 | 角色 |
| --- | --- |
| 平台协议 | 定义基础协议形状与版本策略 |
| Realm | 拥有六个基础协议的真相来源与语义执行 |
| App | 消费与观察；**不**执行 |

`P-PROTO-003` 规则把基础协议语义执行与真相来源钉到 Realm。

## 跨一致

涉及多基础协议的世界转换必须同时满足所有相关基础协议合同：

| 约束 | 为什么 |
| --- | --- |
| 通行必须同时满足 Social + Economy + Context | 通行把参与者跨世界移动；社交身份、经济身份、情境含义都要对齐 |
| 在场**不能**绕过社交准入 | 在世界里「在场」要先有社交准入 |
| Timeflow **不能**破坏经济结算窗口 | 时间进展必须尊重经济结算边界 |

六基础协议**不**是独立 enum。它们互相约束。

## 版本姿态

| 性质 | 值 |
| --- | --- |
| 策略 | `strict-only` |
| 跨 minor 握手 | 禁 |
| 向后兼容 shim | 禁 |
| 失败模式 | 合同违反 fail-close |

客户端必须匹配。**没有**装作兼容、同时违反合同的优雅降级。

## 授权预设

App 在 scoped 授权下跟基础协议交互。平台准入三个预设模板，全共享同一个 token 形状与校验链：

| Preset | 读 | 写 | 委派 |
| --- | --- | --- | --- |
| `readOnly` | 是 | 否 | 否 |
| `full` | 是 | 是 | 否 |
| `delegate` | 是 | 是 | 一级 |

`delegate` 默认允许至多一级进一步委派。

## App 模式

| 模式 | 基础协议读 | 基础协议写 | 每个世界活跃数 |
| --- | --- | --- | --- |
| `render-app` | 是 | 否 | 多个 |
| `extension-app` | 是 | 是 | 每个世界至多一个活跃 |

## 审计事件

跨基础协议动作发审计事件，记在平台审计字典（`.nimi/spec/platform/kernel/tables/audit-events.yaml`）下。

## 来源

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
