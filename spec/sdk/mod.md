# Mod SDK Domain Spec

> Status: Draft
> Date: 2026-02-28
> Scope: `@nimiplatform/sdk/mod` 领域增量规则（host 注入、hook 聚合、UI/i18n/settings facade）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- Surface：`kernel/surface-contract.md`（`S-SURFACE-*`）
- Transport：`kernel/transport-contract.md`（`S-TRANSPORT-*`）
- Error projection：`kernel/error-projection.md`（`S-ERROR-*`）
- Boundary：`kernel/boundary-contract.md`（`S-BOUNDARY-*`）

## 1. 领域不变量

- `SDKMOD-001`: Mod SDK 必须通过 host 注入获取执行能力，导出面遵循 `S-SURFACE-004`（稳定导出面）。
- `SDKMOD-002`: hook client 是唯一跨域调用聚合面。
- `SDKMOD-003`: Mod 不得直接访问 runtime/realm 私有客户端。
- `SDKMOD-004`: 导入边界必须满足 `S-BOUNDARY-003` / `S-BOUNDARY-004`。
- `SDKMOD-005`: 若 hook/event 通道提供订阅语义，断流后不得隐式重连，必须遵循 `S-TRANSPORT-003` 的显式重建原则。

## 2. Host 与 Hook（领域增量）

- `SDKMOD-010`: host 缺失时必须 fail-close（`SDK_MOD_HOST_MISSING`），错误码来源遵循 `S-ERROR-003`（SDK 本地错误码事实源）。
- `SDKMOD-011`: action/event/data/turn/ui/interMod/llm/audit/meta 客户端语义必须保持稳定键名，不允许静默重命名。

## 3. 非目标

- 不定义 desktop 内部执行内核实现
- 不定义 runtime 业务规则
