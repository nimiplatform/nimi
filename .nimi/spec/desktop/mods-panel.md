# Mods Panel Domain Spec

> Normative Imports: `.nimi/spec/desktop/kernel/*`

## Scope

Mods 面板 — Desktop 中 mod 管理的唯一一等公民入口；顶层导航名仍为 `Mods`，其实际页面定义为单一 `Mod Hub`。

## Module Map

- `features/mods/mods-panel.tsx` — `Mods` shell 入口
- `features/mod-hub/` — Mod Hub 业务逻辑与视图

## Kernel References

### Shell (D-SHELL-001, D-SHELL-002)

Mods Tab 受 `enableModUi` feature flag 门控。侧边栏 puzzle icon 直接导航到 `activeTab = 'mods'`。

Guard clause：`enableModUi = false` 时访问 `'mods'` tab 自动回退到 `'chat'`。

### State (D-STATE-003, D-STATE-004)

Mods shell 读取 mod registry、diagnostics、catalog 投影与激活 tab 状态；具体字段与派生状态以实现和 kernel state rule 为准。

### Mod Governance (D-MOD-007)

`Mods` 入口只负责把用户导向统一的 Mod Hub / Mod Workspace 流，不重复定义安装或生命周期动作语义。

## UI Contract

本域只承载 shell entry、source observability 与 conflict/developer-facing boundary：

- `Mods` tab 必须直接进入统一 Mod Hub（`D-SHELL-002`）
- source type、来源目录、冲突状态与调试入口的可见性受 `D-SHELL-010` 治理
- catalog/install/update/manage UX 细节统一留在 `mod-hub.md`

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
