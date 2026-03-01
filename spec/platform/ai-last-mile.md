# AI Last Mile

> Domain: Platform / AI Last Mile
> Status: Active
> Date: 2026-03-01

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/ai-last-mile-contract.md` | P-ALMI-001–030 |
| `kernel/architecture-contract.md` | P-ARCH-004, P-ARCH-010 |

## 1. 文档定位

本域定义跨域总语义（P-ALMI-001），不重写各单域 spec 的底层细节。

## 2. 两段最后一公里

关系连续性（World + Agent + Memory）与能力接入标准化（Local AI Runtime + Mod）必须同时成立（P-ALMI-001）。

## 3. 跨域组件映射

| 层 | 组件 | 归属域 |
|---|---|---|
| 关系层 | World / Agent / Memory | spec/realm/ |
| 能力层 | Local AI Runtime / Mod | spec/runtime/, spec/desktop/ |
| 跨域桥 | Hook Action Fabric | P-ALMI-002 |

## 4. Hook Action Fabric

建立在现有 Hook 之上的 Action 粒度注册协议（P-ALMI-002）。Mod 透明接入（P-ALMI-002）。Principal 模型（P-ALMI-003）。ExternalAgent 接入（P-ALMI-004）。

## 5. Action 契约

Action Registry 字段见 P-ALMI-010。执行协议状态机见 P-ALMI-011。

## 6. 与 Local AI Runtime 的约束

Route source 与回退规则见 P-ALMI-020。

## 7. 性能与可用性红线

见 P-ALMI-030。

## 8. 非目标

不实现跨设备自动编排。不以 UI 自动化为主路径。不绕过 Hook。V1 不提供 AgentToken 模式。
