# Marketplace Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

市场功能域 — 可选 catalog、Mod 安装/更新/卸载、手动本地/远程预构建包安装。

## Module Map

- `features/marketplace/` — 市场面板

## Kernel References

### Shell (D-SHELL-001)

Marketplace 受 `enableMarketplaceTab` feature flag 门控，但不再作为独立 sidebar tab 暴露。
产品主入口位于 `Mods` 页面内部的 Marketplace 视图；`activeTab = 'marketplace'` 仅保留为兼容 alias 路由。

### Mod Governance (D-MOD-001 — D-MOD-008)

市场安装流触发 8 阶段执行内核：
1. Discovery → 从 catalog、本地目录、`.zip` 或 URL 获取预构建 mod 包引用
2. Manifest/Compat → 解析清单和版本兼容性
3. Signature/Auth → 记录供应链元数据与风险提示
4. Dependency/Build → 校验预构建包结构与依赖
5. Sandbox/Policy → 评估 capability 策略
6. Load → 加载入口
7. Lifecycle → 设为 ENABLED
8. Audit → 记录安装决策

没有 catalog 时，Marketplace 仍必须提供 `Install from path` / `Install from URL`。

### State (D-STATE-004)

- `Mods` 页面切换到 Marketplace 视图时渲染 MarketplaceView。
- `activeTab = 'marketplace'` 时必须与 `Mods > Marketplace` 等价，而不是提供第二个独立入口。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
