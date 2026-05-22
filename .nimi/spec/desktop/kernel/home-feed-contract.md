# Home Feed Contract

> Owner Domain: `D-HOMEFEED-*`

## Scope

定义 Desktop primary-navigation `Home` tab 作为 **Realm feed 表面** 的产品
语义内核：`home` tab 渲染 Realm feed surface、三个 feed scope
（`personal` / `friends` / `agent_activity`）的呈现、Create Post affordance、
SDK-typed Realm feed projection 的消费边界、以及 `Home` 与 `Nimi Home`
installed shell（`D-HOME-*`）的显式 non-overlap。

本契约只拥有 **`Home` feed 表面产品语义** authority：`home` tab 呈现什么、
哪些 feed scope 存在、Create Post 入口如何呈现、feed 数据如何被消费。它
**不拥有**：

- shell 导航 tab 体系、布局、路由分包、windowing —— 由
  `ui-shell-contract.md`（`D-SHELL-001`）与 `nimi-home-shell-contract.md`
  （`D-HOME-001`）拥有；
- Realm Post / Feed canonical 真值、feed scope 投影语义、Create Post
  truth-write admission —— 由 Realm `feed-contract.md`（`R-FEED-001` ~
  `R-FEED-010`）拥有；
- Friendship / AgentFriend canonical 社交 admission —— 由 Realm
  `social-contract.md`（`R-SOC-001` ~ `R-SOC-006`）拥有；
- `Nimi Home` installed shell 的 hosted-shell IA、first-run / return-run
  state machine、surface registry、Apps placement —— 由
  `nimi-home-shell-contract.md`（`D-HOME-001` ~ `D-HOME-012`）拥有；
- Realm discovery（Worlds / RealmAgents / public activity 发现）—— 由
  `explore-surface-contract.md`（`D-EXPL-001` ~ `D-EXPL-013`）拥有。

本契约只把上述上游真值在 `Home` feed 产品表面上 **如何被呈现、消费、触发**
固定下来；任何与上述契约冲突的解读以上游契约为准。

## D-HOMEFEED-001 — `Home` Tab 是 Realm Feed 表面

`MUST`：Desktop primary navigation 的 `home` tab 渲染 **Realm feed 表面**。
`Home` 表面呈现 Realm 公共活动 feed 与 Create Post 入口；它是 ordinary
primary navigation `Home | Chat | Explore | Apps | Runtime` 中的
`Home` 项的产品职责。

`MUST`：`home` tab 的 primary-navigation placement 由 `D-SHELL-001` 拥有；
本规则只固定其产品职责为 Realm feed surface。

`MUST NOT`：`Home` feed 表面不得承载 Chat、Explore discovery、
Apps、Runtime 的产品职责；不得把 `Home` 退化成无 feed 语义的 landing /
dashboard 屏。

## D-HOMEFEED-002 — `Home` 不是 Ready Entry

`MUST`：`Home` feed 表面 **不是** Nimi 的 ready entry。Nimi 在 login 与
initialization 完成后的 ready entry 是 `Chat -> Nimi Chat`（产品 ready-entry
权威）；`Home` 只是 ready 之后用户可主动导航进入的一个 primary-nav 表面。

`MUST NOT`：实现不得在 `ready_for_use` 后把首屏落在 `Home` feed 表面；不得
把 `Home` feed 当作 first-run 完成后的默认落点。

## D-HOMEFEED-003 — 与 `Nimi Home` Installed Shell 的 Non-Overlap

`MUST`：`Home`（primary-nav tab、本契约 `D-HOMEFEED-*`）与 `Nimi Home`
（installed product shell、`D-HOME-*` / `nimi-home-shell-contract.md` /
`nimi-home-surfaces.yaml`）是两个不同的产品对象，必须显式 non-overlap：

- `Nimi Home` 是 desktop host 渲染的 **enclosing installed shell**：拥有
  hosted-shell IA、navigation、windowing、first-run / return-run state
  machine、surface registry、Apps placement、Agent Chat in-shell placement
  （`D-HOME-001` ~ `D-HOME-012`）；
- `Home` 是该 shell **内部的一个 primary-nav 表面**：拥有 Realm feed 呈现
  与 Create Post affordance 产品语义（本契约）。

`MUST NOT`：本契约不得重新定义、收窄、或与 `D-HOME-*` 冲突。`Home` feed
表面不得拥有 hosted-shell IA、surface registry、first-run / return-run state
machine、Apps placement、self-update UI、或 failure-projection surface
ownership —— 这些由 `D-HOME-*` 拥有。`D-HOME-*` 也不得被本契约解读为
“`Nimi Home` == `Home` feed tab”。

## D-HOMEFEED-004 — 三个 Feed Scope 呈现

`MUST`：`Home` feed 表面必须呈现 Realm `feed-contract.md`（`R-FEED-005`）
定义的三个 canonical feed scope，呈现事实源为
`tables/home-feed-scopes.yaml`：

| Scope | `Home` 表面呈现职责 |
|---|---|
| `personal` | 呈现 viewer 本人发布的 Post。 |
| `friends` | 呈现 viewer 的 ACTIVE human friends 发布的、对 viewer 可见的 Post。 |
| `agent_activity` | 呈现 RealmAgent 发布的 public activity Post。 |

`MUST`：三个 scope 的投影语义、可见性过滤、author 归属由 Realm
`R-FEED-005` ~ `R-FEED-007` 拥有；本规则只固定 `Home` 表面必须呈现且区分
这三个 scope。

`MUST NOT`：`Home` feed 表面不得新增、删除、或重命名 feed scope 而不更新
`tables/home-feed-scopes.yaml` 与本规则；不得把三个 scope 压缩成无区分的
单一混合流而丢失 scope 语义；不得把 LocalAgent 私有 activity 当作
`agent_activity` 内容呈现（`R-FEED-007`）。

## D-HOMEFEED-005 — Create Post Affordance

`MUST`：`Home` feed 表面必须提供 Create Post affordance —— 用户发布一条
Realm Post 的入口。Create Post 的实际 truth-write admission（author 归属、
attachment envelope、worldId / visibility 解析、内容审核）由 Realm
`feed-contract.md`（`R-FEED-008`、`R-FEED-009`）拥有；本规则只固定 `Home`
表面必须呈现该入口并把发布意图经 SDK-typed Realm 路径提交。

`MUST NOT`：`Home` feed 表面不得在客户端自带 `authorId` / `postId` /
`worldId` / `contentRating` 作为发布权威；不得在 Create Post 部分附件失败、
内容审核熔断、或 Realm 写入失败时投影 generic / synthetic success；任一
失败必须按 typed fail-closed 状态呈现（`R-FEED-009`）。

## D-HOMEFEED-006 — SDK-Typed Realm Feed Projection 消费

`MUST`：`Home` feed 表面的 feed read 与 Create Post 必须通过 SDK typed
path 消费 Realm feed projection（`PostDto` / `FeedResponseDto` typed
contract）。feed 分页必须消费 Realm cursor-paginated typed 投影
（`R-FEED-006`）。

`MUST NOT`：renderer 层不得直接 fetch Realm REST、绕过 SDK 的 typed
projection 形成 shell-local feed authority；不得在 renderer 持有平行 Post /
Feed 真值；不得在 typed feed 投影缺失 / 失败时合成占位 Post、占位附件、
占位计数，或投影 generic success —— 缺失必须 fail-closed 收缩呈现。

## D-HOMEFEED-007 — `Home` Feed 不承载 AI Execution

`MUST`：`Home` feed 表面是 Realm 社交内容的呈现与发布表面。它消费 Realm
feed projection 与 Create Post，不执行 AI。

`MUST NOT`：`Home` feed 表面不得携带 `AIScopeRef`、prompt 文本、
provider/model 选择、或 runtime turn 载荷；不得在 feed read / Create Post
路径上调用 Runtime AI execution。RealmAgent public activity 内容如何生成
属于 Realm Agent 与 Runtime 契约，不在本契约范围（`R-FEED-010`）。

## Fact Sources

- `.nimi/spec/desktop/kernel/tables/home-feed-scopes.yaml` — `Home` 表面三个 feed scope 呈现 catalog
- `.nimi/spec/realm/kernel/feed-contract.md` — `R-FEED-001` ~ `R-FEED-010`（Realm Post / Feed canonical 真值、三个 feed scope、Create Post admission）
- `.nimi/spec/realm/kernel/social-contract.md` — `R-SOC-001` ~ `R-SOC-006`（Friendship / AgentFriend canonical 真值，`friends` scope 的社交 admission 来源）
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — `D-HOME-001` ~ `D-HOME-012`（`Nimi Home` installed shell；与本契约显式 non-overlap）
- `.nimi/spec/desktop/kernel/ui-shell-contract.md` — `D-SHELL-001`（primary navigation tab placement；`home` tab placement 不属本契约）
- `.nimi/spec/desktop/kernel/explore-surface-contract.md` — `D-EXPL-001` ~ `D-EXPL-013`（Realm discovery；与 `Home` feed 表面互不重叠）
