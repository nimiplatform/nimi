# AI Last Mile

> Domain: Platform / AI Last Mile
> Status: Active
> Date: 2026-03-03

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/ai-last-mile-contract.md` | P-ALMI-001–030 |
| `kernel/architecture-contract.md` | P-ARCH-004, P-ARCH-010 |

## 1. 文档定位

本文件是平台 AI 最后一公里的阅读导引。规范条款定义在 kernel（尤其是 P-ALMI-002、P-ALMI-010、P-ALMI-011），domain 文档不重复定义执行规则。

## 2. 阅读路径

1. 先读 `kernel/ai-last-mile-contract.md`，确认 Action Fabric、Principal、执行协议状态机。
2. 再读 `spec/desktop/external-agent.md`，查看 Desktop 对 ExternalAgent 的落地映射。
3. 然后读 `spec/runtime/kernel/auth-service.md` 与 `spec/runtime/kernel/grant-service.md`，确认授权链路与执行边界。

## 3. 跨域映射

- 关系连续性主线：Realm（World/Agent/Memory）语义，见 P-ALMI-001。
- 能力接入主线：Runtime + Desktop Hook Action Fabric，见 P-ALMI-002。
- 外部代理主线：ExternalAgent Principal 与凭证模型，见 P-ALMI-004。
- 路由与可用性：`local-runtime | token-api` 与显式回退语义，见 P-ALMI-020。

## 4. 非目标

- 不提供独立于 Hook Runtime 的旁路执行通道。
- 不在 domain 层定义新的 action 协议字段或状态机。
- 不在本文件记录执行态结果；执行证据写入 `dev/report/*`。
