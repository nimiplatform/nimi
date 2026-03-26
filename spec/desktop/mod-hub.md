# Mod Hub Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

Mod Hub 功能域 — GitHub-first static catalog、Mod 发现、安装、更新、卸载，以及本地 installed mods 目录管理。

## Module Map

- `features/mod-hub/` — Mod Hub 页面逻辑
- `features/mods/mods-panel.tsx` — Mods 顶层入口，直接渲染 Mod Hub

## Kernel References

### Shell (D-SHELL-001, D-SHELL-002)

Mod Hub 没有独立 sidebar tab，也不存在旧的内嵌 alias route。
产品主入口固定为 `Mods` tab；进入后直接渲染单页 Mod Hub。

### Mod Governance (D-MOD-001 — D-MOD-019)

Mod Hub 消费 `D-MOD-001` — `D-MOD-019` 的统一安装治理链。具体的 8 阶段执行、catalog gate、re-consent、ownership continuity 与 advisory/revocation 规则均以 kernel 为准，本域不再复制流程正文。

### State (D-STATE-004)

- `activeTab = 'mods'` 时渲染单页 Mod Hub。
- 已安装 mod、catalog 可发现 mod、更新提示和本地文件夹入口必须出现在同一个 Hub 页面中，而不是拆成旧的两段式结构。

## UI Contract

Mod Hub 只定义 catalog/install/update/manage UX：

- 默认态展示已安装 mod 主视图，并提供 `Open Mods Folder`
- 搜索/聚焦态展开统一 management list
- 行项目动作、图标真相源、trust tier、update/re-consent/warning 与失败态展示都由 `D-MOD-*` 与 `D-SHELL-002` 约束
- source 诊断、来源目录与冲突排障不在本域定义，统一回到 `mods-panel.md` / `D-SHELL-010`

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
