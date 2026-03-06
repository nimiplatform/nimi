# Legal Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

法律页面功能域 — 隐私政策、服务条款展示。

## Module Map

- `features/legal/` — 法律页面（privacy-policy, terms-of-service）

## Kernel References

### State (D-STATE-004)

- `activeTab = 'privacy-policy'` 时渲染隐私政策页面。
- `activeTab = 'terms-of-service'` 时渲染服务条款页面。

### Shell (D-SHELL-001)

Legal tabs 属于 `detail` 导航组，不在 sidebar 显示，通过设置页面或 URL 导航进入。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
