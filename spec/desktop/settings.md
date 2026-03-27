# Settings Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

设置功能域 — 用户设置、通知偏好、创作者资格、Mod 设置扩展。

## Module Map

- `features/settings/` — 设置面板（页面路由、资源、持久化）
- `runtime/data-sync/flows/settings-flow.ts` — 设置数据流

## Kernel References

### DataSync (D-DSYNC-010)

设置数据流（方法清单见 `D-DSYNC-010`）。

### State (D-STATE-004)

- `activeTab = 'settings'` 时渲染 SettingsPanel。

### Hook (D-HOOK-004)

Settings 可用扩展槽位以 `spec/desktop/kernel/tables/ui-slots.yaml` 为准；本域只引用 `D-HOOK-004`。

### Shell (D-SHELL-002)

`enableSettingsExtensions` feature flag 控制扩展区域是否渲染。

### Sidebar Family (D-SHELL-023, D-SHELL-024, D-SHELL-025)

Settings 内部左侧栏属于 desktop governed sidebar family：

- `settings-panel-body` 必须登记到 `renderer-design-sidebars.yaml`。
- sectioned nav 只能使用 `nav-row` item kind。
- sidebar 背景、active row、section label 与 resize handle 必须通过 shared sidebar primitive 与 sidebar token 统一。

### Bootstrap / IPC (D-BOOT-001, D-IPC-014, D-IPC-015)

Settings 的 Application Update 区域必须投影 desktop self-update 状态：

- 展示当前 desktop 版本、bundled runtime 版本、目标版本、当前 updater 状态。
- `autoUpdate` 语义固定为“自动检查并下载”；安装完成后仍需显式重启。
- runtime staging / release metadata 错误必须在设置页中可见，不得靠 fallback 版本信息掩盖。
- updater availability 与禁用/告警投影遵循 `spec/desktop/kernel/self-update-contract.md` 的 `Updater Availability Projection`，此处不重复定义规则正文。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`（Check 1, 4, 9, 11, 13~14 相关规则）。
