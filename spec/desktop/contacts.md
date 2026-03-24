# Contacts Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

通讯录功能域 — 联系人列表、好友请求、搜索用户、添加/删除好友、拉黑/解除拉黑。

## Module Map

- `features/contacts/` — 通讯录面板（联系人视图、添加联系人弹窗）
- `runtime/data-sync/flows/social-flow.ts` — 社交数据流

## Kernel References

### UI Shell (D-SHELL-019, D-SHELL-022)

`contacts` 是 desktop baseline anchor 之一。root shell、sidebar/list surface、shared action 与确认 dialog family 的 baseline design 收敛由 `D-SHELL-019` 与 `D-SHELL-022` 定义。

### DataSync (D-DSYNC-004)

社交数据流（方法清单见 `D-DSYNC-004`）。辅助方法 `isFriend(userId)` 在 contacts 状态中检查好友关系。

### State (D-STATE-004)

- `activeTab = 'contacts'` 时渲染 ContactsPanel。

### Bootstrap (D-BOOT-003)

联系人数据在 `loadInitialData()` 中加载（`D-DSYNC-004`）。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
