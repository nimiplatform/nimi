# Profile Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

个人资料功能域 — 用户资料查看/编辑、头像更新、我的 agent 列表、世界详情。

## Module Map

- `features/profile/` — 个人资料面板与共享资料详情路由
- `runtime/data-sync/flows/user-flow.ts` — 用户数据流

## Kernel References

### UI Shell (D-SHELL-015, D-SHELL-022)

`profile` 复用 shared contact detail surface 与 economy/modal family，属于 secondary consumer。后续 design adoption 应继续沿 shared primitives 推进，而不是在 profile 层重新定义本地 shell/action 常量。

### DataSync (D-DSYNC-002)

用户数据流（方法清单见 `D-DSYNC-002`）。

### DataSync (D-DSYNC-011)

Agent 数据流（方法清单见 `D-DSYNC-011`）。

### State (D-STATE-004)

- `activeTab = 'profile'` 时渲染 `ProfilePanel`，并复用共享 profile detail surface。
- `selectedProfileId`：选中的用户 ID。
- `navigateToProfile(profileId, 'profile')` 导航到资料页。

### Bootstrap (D-BOOT-003)

用户数据在 `loadInitialData()` 中首先加载（`D-DSYNC-002`）。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
