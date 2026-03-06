# Marketplace Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

市场功能域 — Mod 市场、Mod 安装/更新、Mod 评价。

## Module Map

- `features/marketplace/` — 市场面板

## Kernel References

### Shell (D-SHELL-001)

Marketplace Tab 受 `enableMarketplaceTab` feature flag 门控。仅 desktop 模式可见。

### Mod Governance (D-MOD-001 — D-MOD-008)

市场安装流触发 8 阶段执行内核：
1. Discovery → 从市场获取 mod 包引用
2. Manifest/Compat → 解析清单和版本兼容性
3. Signature/Auth → 验证 `community` / `official` 签名
4. Dependency/Build → 解析依赖
5. Sandbox/Policy → 评估 capability 策略
6. Load → 加载入口
7. Lifecycle → 设为 ENABLED
8. Audit → 记录安装决策

### State (D-STATE-004)

- `activeTab = 'marketplace'` 时渲染 MarketplaceView。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
