# Mod Governance Contract

> Authority: Desktop Kernel
> Status: Draft
> Date: 2026-03-01

## Scope

Desktop Mod 治理契约。定义 8 阶段执行内核、4 种访问模式、8 种生命周期状态、决策记录和审计要求。

## D-MOD-001 — Discovery 阶段

定位 mod 包并验证源引用：

- 输入：`DiscoverInput`（modId、version、mode、source）。
- 验证：source ref 存在性、mod ID 格式。
- 成功：状态 → `DISCOVERED`。

## D-MOD-002 — Manifest/Compat 阶段

解析清单并检查兼容性：

- 解析 `ModManifest`（id、version、capabilities、dependencies、entry）。
- 检查 `nimi.minVersion` / `nimi.maxVersion` 约束。
- 失败：输出决策记录，不进入下一阶段。

## D-MOD-003 — Signature/Auth 阶段

验证 mod 签名和签署者身份：

- `official` / `community` mode：要求 signerId、signature、digest。**（Phase 2 detail — Phase 1 仅支持 `local-dev` / `sideload`，签名验证基础设施待实现）**
- `local-dev` / `sideload` mode：跳过签名验证。
- 成功：状态 → `VERIFIED`。

## D-MOD-004 — Dependency/Build 阶段

解析依赖并构建 mod bundle：

- 解析 `manifest.dependencies` 列表。
- 验证所有依赖已注册或可用。**（Phase 2 detail — Phase 1 mod 无跨 mod 依赖，此阶段执行空依赖校验后直接通过）**
- 成功：状态 → `INSTALLED`。

## D-MOD-005 — Sandbox/Policy 阶段

评估 capability 策略和沙箱约束：

- 解析 `requestedCapabilities`。
- 根据 `sourceType` → `AccessMode` 映射查找允许的能力白名单（参考 `D-HOOK-007`）。
- Grant ref 验证（如提供 `grantRef`）。
- 决策结果：`ALLOW`、`ALLOW_WITH_WARNING`、`DENY`。

**正交性说明**：Mod capability 检查是 renderer 本地门控，在 mod 调用 SDK 方法前执行。此机制与 Runtime K-GRANT token 授权正交——即使 mod 通过 Desktop capability 检查，其 SDK 请求仍需通过 Runtime K-DAEMON-005 authz 拦截器的 token 验证。两层各自独立执行，不存在绕过关系。

## D-MOD-006 — Load 阶段

加载 mod 入口到运行时上下文：

- 读取 `manifest.entry` 指向的源码。
- 在沙箱环境中执行 mod 注册。

## D-MOD-007 — Lifecycle 阶段

执行生命周期迁移：

- `enable`：`INSTALLED` / `DISABLED` → `ENABLED`
- `disable`：`ENABLED` → `DISABLED`
- `uninstall`：`INSTALLED` / `DISABLED` → `UNINSTALLED`
- `update`：`ENABLED` → `UPDATING` → `ENABLED`（失败时 → `ROLLBACK_DISABLED`）

## D-MOD-008 — Audit 阶段

写入审计决策记录：

- `DecisionRecord`：decisionId、modId、version、stage、result、reasonCodes、createdAt。
- `LocalAuditRecord`：id、modId、stage、eventType、decision、reasonCodes、payload、occurredAt。
- 每个 kernel stage 完成后必须产出至少一条审计记录。

## D-MOD-009 — Access Mode 策略

4 种访问模式的能力约束：

| Mode | 签名要求 | 能力白名单映射 | 信任级别 |
|---|---|---|---|
| `local-dev` | 无 | 按 sourceType 查表 | high |
| `community` | 必须 | 按 sourceType 查表 | medium |
| `official` | 必须（平台签名） | 按 sourceType 查表 | high |
| `sideload` | 无 | `sideload` 白名单 | low |

## D-MOD-010 — Decision Result 语义

- `ALLOW`：通过，进入下一阶段。
- `ALLOW_WITH_WARNING`：通过但记录警告 reason codes。
- `DENY`：拒绝，终止流水线，记录拒绝原因。

## Fact Sources

- `tables/mod-kernel-stages.yaml` — 8 阶段枚举
- `tables/mod-lifecycle-states.yaml` — 生命周期状态
- `tables/mod-access-modes.yaml` — 访问模式
