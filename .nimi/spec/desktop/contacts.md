# Contacts Domain Spec

> Normative Imports: `.nimi/spec/desktop/kernel/*`

## Scope

通讯录功能域 — 联系人列表、好友请求、搜索用户、添加/删除好友、拉黑/解除拉黑。

## Module Map

- `features/contacts/` — 通讯录面板（联系人视图、添加联系人弹窗）
- `runtime/data-sync/flows/social-flow.ts` — 社交数据流

## Kernel References

### UI Shell (D-SHELL-019, D-SHELL-022, D-SHELL-023, D-SHELL-024, D-SHELL-025)

`contacts` 是 desktop baseline anchor 之一。root shell、sidebar/list surface、shared action 与确认 dialog family 的 baseline design 收敛由 `D-SHELL-019` 与 `D-SHELL-022` 定义。

Contacts 内部左侧栏属于 governed sidebar family：

- `contacts-view` 必须登记到 `renderer-design-sidebars.yaml`。
- category-row、entity-row、search、primary action 与 resize handle 必须通过 shared sidebar primitive 表达。
- search 必须默认折叠为图标触发态：未输入时仅渲染搜索图标按钮，点击后向左展开为输入框；输入框失去焦点且为空时自动收起，按下 `Escape` 时清空并收起。该行为通过 `SidebarSearch` 的 `collapsible` 入口表达，禁止以始终展开的形式重新实现。

### DataSync (D-DSYNC-004)

社交数据流（方法清单见 `D-DSYNC-004`）。辅助方法 `isFriend(userId)` 在 contacts 状态中检查好友关系。

### State (D-STATE-004)

- `activeTab = 'contacts'` 时渲染 ContactsPanel。

### Bootstrap (D-BOOT-003)

联系人数据在 `loadInitialData()` 中加载（`D-DSYNC-004`）。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm exec nimicoding validate-spec-governance --profile nimi --scope desktop-consistency`。
