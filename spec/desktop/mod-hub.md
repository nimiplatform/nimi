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

市场安装流触发 8 阶段执行内核：
1. Discovery → 从 catalog 或已落盘的 installed mods 目录获取 mod 包引用
2. Manifest/Compat → 解析清单和版本兼容性
3. Signature/Auth → 校验 digest、signature、revocation，并记录供应链元数据与风险提示
4. Dependency/Build → 校验预构建包结构与依赖
5. Sandbox/Policy → 评估 capability 策略
6. Load → 加载入口
7. Lifecycle → 设为 ENABLED
8. Audit → 记录安装决策

本地 sideload 仍受 `D-MOD-003` 的 `sideload` 信任模型约束，但产品 UI 不再提供任意 path / URL 输入框。用户如需本地安装，必须通过 `Open Mods Folder` 打开 desktop managed installed mods 目录后手动复制。

Catalog v1 约束：

- Desktop 只消费 `packageType=desktop-mod`
- `packageType=nimi-app` 可展示但不得提供安装入口
- `packageType=nimi-app` 的 release 记录可额外携带 `appMode`、`scopeCatalogVersion`、`minRuntimeVersion`；desktop v1 只透传、不消费
- trust tier 固定为 `official | verified | community`
- catalog update 必须先完成 release 元数据校验，再复用本地 mod update pipeline
- install/update 返回值必须暴露 `requiresUserConsent`、`consentReasons[]`、`addedCapabilities[]`
- 若目标 release 命中 revocation 或 advisory `block`，Mod Hub 不得展示为可安装/可更新目标
- official package 的 release asset 上传不等于上架；只有 catalog 合并并发布后才可对 Desktop 可见（见 `D-MOD-016`）
- 第三方 package 默认保留外部 source repo ownership；`verified/community` listing 不得要求源码并入 `nimi-mods`（见 `D-MOD-017`）
- signer / publisher ownership / capability 增量 / trust tier 变化会触发第三方更新复审（见 `D-MOD-019`）

### State (D-STATE-004)

- `activeTab = 'mods'` 时渲染单页 Mod Hub。
- 已安装 mod、catalog 可发现 mod、更新提示和本地文件夹入口必须出现在同一个 Hub 页面中，而不是拆成旧的两段式结构。

## UI Contract

- 默认态采用 Launchpad / Dock 风格：仅展示已安装 mod 的图标墙。
- 图标真相源优先级固定为：installed/dev local manifest `iconAsset` > catalog `iconUrl` > fallback 首字母占位。
- Desktop 不得通过内置官方 mod svg 或 `mod id -> icon` 私有映射渲染 Mod Hub 图标。
- 页面必须提供 `Open Mods Folder` 按钮，打开 desktop managed installed mods 目录。
- 搜索框获得焦点时，Hub 必须展开 unified management list：
  - 默认按 `Installed` → `Available via Catalog` 分组
  - 输入非空时统一过滤，但保留分组标题
- Unified list 行项目必须承载完整管理动作：
  - `Install / Update / Open / Enable / Disable / Uninstall / Retry`
  - 低频或破坏性动作可进入 `More` 菜单
- 冲突态或失败态 mod 必须在 unified list 明确展示原因，并只暴露安全动作。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
