# SDK Kernel Contracts

> Status: Draft
> Date: 2026-02-28
> Scope: `@nimiplatform/sdk` 跨域契约（Runtime SDK / Realm SDK / Scope SDK / Mod SDK / AI Provider SDK）。

## 1. 目标

本目录是 SDK 规范的唯一权威层（kernel layer）。
跨 SDK 规则必须在 kernel 定义一次，domain 文档只允许引用 Rule ID。

## 2. One Fact One Home

- 单一事实源：同一规则只允许在一个 kernel 文件定义。
- 下游投影：`spec/sdk/*.md` 只能引用 kernel Rule ID，不得复述通用规则正文。
- 冲突处理：若 domain 与 kernel 冲突，以 kernel 为准；domain 必须同次修正。

## 3. Rule ID 规范

- 格式：`S-<DOMAIN>-NNN`
- `DOMAIN` 固定枚举：`SURFACE` `TRANSPORT` `ERROR` `BOUNDARY`
- `NNN` 三位递增编号，不复用。

## 4. 文档所有权

| 文档 | Domain | 说明 |
|---|---|---|
| `surface-contract.md` | `S-SURFACE-*` | SDK 子路径、导出面、Runtime 方法投影分组 |
| `transport-contract.md` | `S-TRANSPORT-*` | Runtime/Realm 传输模型、metadata 映射、流行为边界 |
| `error-projection.md` | `S-ERROR-*` | Runtime/Realm 错误投影、SDK 本地错误码与重试语义 |
| `boundary-contract.md` | `S-BOUNDARY-*` | 跨包导入边界与禁止路径 |

## 5. 结构化事实源

- `tables/sdk-surfaces.yaml`
- `tables/runtime-method-groups.yaml`
- `tables/import-boundaries.yaml`
- `tables/sdk-error-codes.yaml`

## 6. 下游引用约束

- `runtime.md`: Runtime SDK 投影（初始化、模块编排、与 runtime kernel 绑定）
- `ai-provider.md`: AI Provider SDK 投影（AI SDK v3 兼容层）
- `realm.md`: Realm SDK 投影（REST/WS facade）
- `scope.md`: Scope SDK 投影（scope catalog 与授权前置）
- `mod.md`: Mod SDK 投影（host 注入、hook 聚合、UI/i18n/settings）
