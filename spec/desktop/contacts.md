# Contacts Domain Spec

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-01

## Scope

通讯录功能域 — 联系人列表、好友请求、搜索用户、添加/删除好友、拉黑/解除拉黑。

## Module Map

- `features/contacts/` — 通讯录面板（联系人视图、添加联系人弹窗）
- `runtime/data-sync/flows/social-flow.ts` — 社交数据流

## Kernel References

### DataSync (D-DSYNC-004)

社交数据流（方法清单见 `D-DSYNC-004`）。辅助方法 `isFriend(userId)` 在 contacts 状态中检查好友关系。

### State (D-STATE-004)

- `activeTab = 'contacts'` 时渲染 ContactsPanel。

### Bootstrap (D-BOOT-003)

联系人数据在 `loadInitialData()` 中加载（`D-DSYNC-004`）。
