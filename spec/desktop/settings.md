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

UI 扩展槽位：`settings.panel.section` — 设置面板扩展区域，mod 可注册自定义设置项。

### Shell (D-SHELL-002)

`enableSettingsExtensions` feature flag 控制扩展区域是否渲染。

### Bootstrap / IPC (D-BOOT-001, D-IPC-009)

Settings 的 Application Update 区域必须投影 desktop self-update 状态：

- 展示当前 desktop 版本、bundled runtime 版本、目标版本、当前 updater 状态。
- `autoUpdate` 语义固定为“自动检查并下载”；安装完成后仍需显式重启。
- runtime staging / release metadata 错误必须在设置页中可见，不得靠 fallback 版本信息掩盖。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`（Check 1, 4, 9, 11, 13~14 相关规则）。
