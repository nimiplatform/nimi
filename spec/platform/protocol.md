# Platform Protocol

> Domain: Platform / Protocol
> Status: Frozen
> Date: 2026-03-01

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/protocol-contract.md` | P-PROTO-001–105 |
| `kernel/tables/protocol-error-codes.yaml` | 错误码字典 |
| `kernel/tables/protocol-primitives.yaml` | 六原语字段 |
| `kernel/tables/compliance-test-matrix.yaml` | L0-L2 合规矩阵 |
| `kernel/tables/audit-events.yaml` | 审计事件字典 |
| `kernel/tables/app-authorization-presets.yaml` | 授权预设规则 |
| `kernel/tables/participant-profiles.yaml` | 参与方能力画像 |

## 1. 文档定位

本文件是域增量文档，提供协议规范的阅读导引与补充语境。所有强制规则定义在 kernel 中。

## 2. 协议分层

| 层 | 交互对象 | 关注点 |
|---|---|---|
| L0 Core Envelope | 任意参与方 | trace/idempotency/error/audit 基础封装 |
| L1 Runtime Access | runtime ↔ app/external | AI 运行时访问、授权、App 间受控访问 |
| L2 Realm Core Profile | realm ↔ app | world/agent/memory/social/economy 与六原语 |

## 3. 版本协商

V1 strict-only（P-PROTO-001）。版本字段：protocolVersion, participantProtocolVersion, compatMode, capabilityProfileRef, scopeCatalogVersion 等。协商输出：accepted, effectiveProtocolVersion, compatMode, reasonCode, actionHint, requiredActions。

## 4. 统一封装

请求/响应封装规则见 P-PROTO-010, P-PROTO-011。能力画像采用固定发布（P-PROTO-002），详见 `tables/participant-profiles.yaml`。

## 5. App 授权合同

ExternalPrincipal 授权规则见 P-PROTO-020–040。三种预设见 `tables/app-authorization-presets.yaml`。委托规则见 P-PROTO-035。策略更新与 catalog 规则见 P-PROTO-040。

## 6. World-App 关系

产品绑定关系见 P-PROTO-050。render-app 只读，extension-app 需 1:1 绑定。

## 7. 六原语合同

六原语字段定义见 `tables/protocol-primitives.yaml`（P-PROTO-100–105）。跨原语一致性规则见 P-PROTO-070。

## 8. 错误码

完整错误码字典见 `tables/protocol-error-codes.yaml`。审计事件字典见 `tables/audit-events.yaml`。

## 9. 合规测试

L0-L2 合规测试矩阵见 `tables/compliance-test-matrix.yaml`。

## 10. 决策收敛

已决策：不允许 legacy-readonly、不允许 per-primitive 独立版本号、固定参与方不远程下发、不允许二次委托、策略更新立即失效、extension-app 固定 1:1、scope 采用 SDK 单入口。
