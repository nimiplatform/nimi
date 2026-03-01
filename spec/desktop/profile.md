# Profile Domain Spec

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-01

## Scope

个人资料功能域 — 用户资料查看/编辑、头像更新、我的 agent 列表、世界详情。

## Module Map

- `features/profile/` — 个人资料视图
- `runtime/data-sync/flows/user-flow.ts` — 用户数据流

## Kernel References

### DataSync (D-DSYNC-002)

用户数据流（方法清单见 `D-DSYNC-002`）。

### DataSync (D-DSYNC-011)

Agent 数据流（方法清单见 `D-DSYNC-011`）。

### State (D-STATE-004)

- `activeTab = 'profile'` 时渲染 ProfileView。
- `selectedProfileId`：选中的用户 ID。
- `navigateToProfile(profileId, 'profile')` 导航到资料页。

### Bootstrap (D-BOOT-003)

用户数据在 `loadInitialData()` 中首先加载（`D-DSYNC-002`）。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
