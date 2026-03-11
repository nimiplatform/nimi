# Marketplace Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

市场功能域 — GitHub-first static catalog、Mod 安装/更新/卸载、手动本地/远程预构建包安装。

## Module Map

- `features/marketplace/` — 市场面板

## Kernel References

### Shell (D-SHELL-001)

Marketplace 受 `enableMarketplaceTab` feature flag 门控，但不再作为独立 sidebar tab 暴露。
产品主入口位于 `Mods` 页面内部的 Marketplace 视图；`activeTab = 'marketplace'` 仅保留为兼容 alias 路由。

### Mod Governance (D-MOD-001 — D-MOD-019)

市场安装流触发 8 阶段执行内核：
1. Discovery → 从 catalog、本地目录、`.zip` 或 URL 获取预构建 mod 包引用
2. Manifest/Compat → 解析清单和版本兼容性
3. Signature/Auth → 校验 digest、signature、revocation，并记录供应链元数据与风险提示
4. Dependency/Build → 校验预构建包结构与依赖
5. Sandbox/Policy → 评估 capability 策略
6. Load → 加载入口
7. Lifecycle → 设为 ENABLED
8. Audit → 记录安装决策

没有 catalog 时，Marketplace 仍必须提供 `Install from path` / `Install from URL`。

Catalog v1 约束：

- Desktop 只消费 `packageType=desktop-mod`
- `packageType=nimi-app` 可展示但不得提供安装入口
- `packageType=nimi-app` 的 release 记录可额外携带 `appMode`、`scopeCatalogVersion`、`minRuntimeVersion`；desktop v1 只透传、不消费
- trust tier 固定为 `official | verified | community`
- catalog update 必须先完成 release 元数据校验，再复用本地 mod update pipeline
- install/update 返回值必须暴露 `requiresUserConsent`、`consentReasons[]`、`addedCapabilities[]`
- 若目标 release 命中 revocation 或 advisory `block`，Marketplace 不得展示为可安装/可更新目标
- official package 的 release asset 上传不等于上架；只有 catalog 合并并发布后才可对 Desktop 可见（见 `D-MOD-016`）
- 第三方 package 默认保留外部 source repo ownership；`verified/community` listing 不得要求源码并入 `nimi-mods`（见 `D-MOD-017`）
- signer / publisher ownership / capability 增量 / trust tier 变化会触发第三方更新复审（见 `D-MOD-019`）

### State (D-STATE-004)

- `Mods` 页面切换到 Marketplace 视图时渲染 MarketplaceView。
- `activeTab = 'marketplace'` 时必须与 `Mods > Marketplace` 等价，而不是提供第二个独立入口。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
