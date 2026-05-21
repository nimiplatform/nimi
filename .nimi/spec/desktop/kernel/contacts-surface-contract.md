# Contacts Surface Contract

> Owner Domain: `D-CONTACTS-*`

## Scope

定义 Desktop `Contacts` 作为 primary-navigation **关系管理**表面的产品语义
内核：两个 relationship category（`human_friends` / `agent_friends`）、
friend request（received / sent 及其 accept / reject / cancel）、blocked
users（block / unblock）、relationship detail 表面、Agent-friend limit 的
single baseline 配额语义，以及 AgentFriend ↔ LocalAgent 的 one-to-one 关系
（含删除联动）。

本契约只拥有 **Contacts 关系管理产品语义** authority：Contacts 表面承载
哪些已存在关系、如何分类、friend request 如何被处理、blocked 关系如何呈现
与解除、relationship detail 呈现什么、Agent-friend 配额如何被产品消费。
它 **不拥有**：

- shell 导航 tab 体系、布局、路由分包、视觉编排 —— 由 `ui-shell-contract.md`
  （`D-SHELL-001`、`D-SHELL-006`、`D-SHELL-032`）拥有；
- Realm discovery（Worlds / RealmAgents / public activity / RealmAgent
  creation）—— 由 `explore-surface-contract.md`（`D-EXPL-001` ~ `D-EXPL-013`）
  拥有；
- Friendship / AgentFriend / friend-request / block 的 canonical 社交
  admission 真值与 friendship graph —— 由 Realm `social-contract.md`
  （`R-SOC-001` ~ `R-SOC-006`）拥有；
- RealmAgent friend-state → primary-action 状态机 —— 由 `D-EXPL-006` 与
  `tables/realm-agent-friend-actions.yaml` 拥有；
- LocalAgent projection 的 Runtime 生成 / 修复 / 终止语义 —— 由
  `runtime-agent-service-contract.md`（`K-AGCORE-139`、`TerminateAgent`）拥有；
- LocalAgent Chat 的 `localAgentRef` 身份与会话真值 —— 由 Realm
  `chat-contract.md`（`R-CHAT-016` ~ `R-CHAT-020`）拥有。

本契约只把上述上游真值在 Contacts 产品表面上 **如何被管理、分类、呈现、
触发** 固定下来；任何与上述契约冲突的解读以上游契约为准。

## D-CONTACTS-001 — Contacts 是关系管理表面

`MUST`：`Contacts` 是 primary navigation 的 **关系管理**（relationship
management）表面，承载当前账号 **已存在的**关系：human friends、Agent
friends、friend requests、blocked users。它管理的是关系真值的生命周期
（查看 / 接受 / 拒绝 / 取消 / 屏蔽 / 解除屏蔽 / 移除），不承担发现职责。

`MUST`：`Contacts` primary navigation 入口由 `D-SHELL-001` 拥有（core nav
六项之一）；本规则只固定其产品职责为 relationship management。

`MUST`：`Contacts` 与 `Explore` 是显式 non-overlap 的两个表面。`Explore`
拥有 Realm **discovery**（发现新 Worlds / RealmAgents / public activity、
发起新关系）；`Contacts` 拥有 **已存在关系的管理**。新关系一旦经
admitted 社交路径建立，即成为 Contacts 的管理对象。

`MUST NOT`：`Contacts` 不得承载 Realm discovery —— 不得在 Contacts 内嵌入
World / RealmAgent 浏览区、public activity feed、或 RealmAgent / World
creation 入口；这些属于 `Explore`（`D-EXPL-001` ~ `D-EXPL-013`）。

`MUST NOT`：`Contacts` 不得自持平行的 friendship / friend-request / block
真值；它只消费 Realm `social-contract.md` 的 canonical 社交投影。

## D-CONTACTS-002 — 两个 Relationship Category

`MUST`：`Contacts` 的 relationship category 固定为且仅为两个，语义事实源为
`tables/contacts-categories.yaml`：

| Category | 产品职责 |
|---|---|
| `human_friends` | 当前账号的 active human-to-human Friendship 关系；每项解析为一个 human contact。 |
| `agent_friends` | 当前账号的 active AgentFriend 关系；每项解析为一个 one-to-one LocalAgent projection。 |

`MUST`：owner 自己在 Explore / Forge 创建的 RealmAgent，如果该账号同时与
其建立了 AgentFriend 关系，则它作为普通 AgentFriend 出现在 `agent_friends`
内 —— 与任何其它 AgentFriend 无产品区分。

`MUST NOT`：不得新增第三个 category。特别地，**不得**为 owner-created /
owner-owned Agent 设立独立的 `myAgents` / `MASTER_OWNED` 类目 —— Contacts
的关系模型严格为 human friends + Agent friends。owner-created RealmAgent 的
创作与归属属于 Explore / Forge 的 creation 关注点，不是 Contacts 的
top-level category。

`MUST NOT`：不得新增、删除、或重命名 category 而不更新
`tables/contacts-categories.yaml` 与本规则；不得把两个 category 压缩成
无区分的混合 contact 列表而丢失 human / Agent 的 typed distinction。

## D-CONTACTS-003 — Friend Request：Received / Sent 与处理动作

`MUST`：`Contacts` 必须管理 friend request 的两个方向，语义事实源为
`tables/contacts-friend-request-states.yaml`：

- **received**（inbound）：他方向当前账号发起的请求；
- **sent**（outbound）：当前账号向他方发起的请求。

`MUST`：friend request 的处理动作固定为：

| 方向 | Admitted 动作 | 产品结果 |
|---|---|---|
| received | `Accept` | 经 Realm 社交 admission 建立 canonical 关系；关系转入相应 category。 |
| received | `Reject` | 拒绝该 inbound 请求；不建立关系。 |
| sent | `Cancel` | 撤回当前账号自己的 outbound 请求；不建立关系。 |

`MUST`：friend request 的方向与状态必须来自 Realm `social-contract.md` 的
canonical 社交真值投影（`R-SOC-001`）；`Accept` / `Reject` / `Cancel` 都
必须经 admitted 上游社交路径完成。

`MUST`：`Accept` 一个 received Agent friend request 与 Explore 的 `Add
friend`（`D-EXPL-007`）等价地产生 AgentFriend 关系，并因此触发
`D-CONTACTS-007` 的 LocalAgent one-to-one projection 创建。

`MUST NOT`：不得对一个 `sent_pending` 请求重复发起从而产生 duplicate
friend request；`sent` 方向在 pending 期间只暴露 `Cancel`，不暴露可重复
触发的 re-send。

`MUST NOT`：不得把 received / sent 两个方向压缩成无区分的单一 request 列表
而丢失 typed direction；不得把 `Reject` 与 `Cancel` 混为同一动作 —— 二者
分别属于 received 与 sent 方向。

## D-CONTACTS-004 — Blocked Users：Block / Unblock 与 Chat 阻断

`MUST`：`Contacts` 必须呈现 blocked users 集合，并提供 `Block` 与
`Unblock` 两个动作。被屏蔽对象的 block / unblock 真值来自 Realm
`social-contract.md` 的 canonical 社交 admission，本契约只固定其在 Contacts
表面的产品呈现与触发。

`MUST`：被当前账号 block 的 contact **不能 chat** —— Contacts 不得对一个
blocked contact 暴露可用的 chat 入口（Human Chat 或 LocalAgent Chat）。
chat 阻断是 blocked 关系的产品后果。

`MUST`：`Unblock` 解除屏蔽后，该对象的关系回到其原有 category 的普通管理
语义；是否仍为 friend 取决于 Realm 社交真值，Contacts 不在客户端自行
重建关系。

`MUST NOT`：Contacts 不得对 blocked contact 投影“伪装可用、点击后报错”的
chat 入口 —— chat affordance 必须 fail-closed 收缩，不渲染。

`MUST NOT`：Contacts 不得自持平行的 block 真值，也不得在客户端绕过 Realm
社交 admission 直接写入 block / unblock 结果。

## D-CONTACTS-005 — Relationship Detail 表面

`MUST`：`Contacts` 必须提供 relationship detail 表面，呈现单个关系的产品
事实：对方 identity（human contact 或 Agent friend）、relationship 状态、
以及该关系 admitted 的管理动作（如 message / remove friend / block /
unblock，按关系类型与状态收缩）。

`MUST`：relationship detail 呈现的关系状态与 identity 必须来自上游
canonical 投影 —— human friend 来自 Realm `social-contract.md` 的
Friendship 投影；Agent friend 来自 AgentFriend 投影及其 one-to-one
LocalAgent projection（`K-AGCORE-139`）。

`MUST`：Agent friend 的 relationship detail 的 chat 动作必须解析到该
one-to-one LocalAgent 实例的 LocalAgent Chat（见 `D-CONTACTS-008`）。

`MUST NOT`：relationship detail 不得呈现上游真值不存在的派生字段作为
detail 真值来源；缺失字段按缺失收缩，不得保留空占位或合成占位值。

`MUST NOT`：relationship detail 不得为 Agent friend 暴露对 bare RealmAgent
的直接 chat / interaction 入口（见 `D-CONTACTS-008`）。

## D-CONTACTS-006 — Agent-Friend Limit：Single Baseline 配额

`MUST`：`agent_friends` 受一个 Agent-friend limit 约束。当前阶段该 limit
是 **单一 baseline 值**；Contacts 表面只 **消费** 该配额真值并据此呈现
状态与路由动作。

`MUST`：该 baseline limit 的 canonical authority owner 是 **单一
backend-owned baseline 常量**。当前阶段它由 backend 拥有并定义为一个值
（一个数字，不带 `SubscriptionTier` 参数），位于 backend economy/social
配额 authority 表面；backend 的 AgentFriend 创建准入路径（`addFriend` /
`addOrAcceptFriend` 的配额校验）以及任何把该 limit 投影给客户端的
admitted 上游投影都必须消费这同一个常量。该 baseline 值不得由 renderer
或 Desktop 客户端拥有或定义。如果未来配额需要 per-device / runtime 差异，
runtime / `.nimi` config 拥有的配额值是一个 **later admitted** 变更，不是
当前 baseline；当前 baseline 的 authority owner 明确为 backend-owned 常量。

`MUST`：该 baseline limit 不得在 renderer / Desktop 客户端 hardcode；它必须
来自 admitted 上游配额投影，该投影的真值来源是上面这个 backend-owned
baseline 常量。Contacts 在配额真值不可用时按 typed fail-closed 状态呈现，
不得 hardcode 一个猜测上限，也不得在配额投影失败时回退到一个
renderer-猜测的 tier 默认值（例如 `FREE` tier 的固定上限）。

`MUST`：当 `agent_friends` 达到配额（`limit_reached`），新增 Agent friend
的 primary action 必须路由到 **manage / remove** —— 引导用户移除某个既有
AgentFriend 以释放配额。此处与 Explore 的 `D-EXPL-006`
`limit_reached → Manage Agent friends` 状态一致：`Manage Agent friends`
落到 Contacts 的 `agent_friends` 管理表面。

`MUST NOT`：Agent-friend limit **不得**耦合 subscription tier。当前阶段
产品无 economy / purchase 概念，paid upgrade / tier 属 "later admitted"。
本契约 spec 的是 ONE baseline limit，不得引入 `FREE` / `PRO` / `MAX` 或
任何 tier-differentiated 配额；不得用 `SubscriptionTier` 参数化该 limit，
不得维护一个 per-tier 配额表（如 `{FREE, PRO, MAX}` 上限映射），也不得
在 backend 配额校验里按 caller 的 subscription tier 解析 limit。tier
差异化配额在被单独 admit 之前明确 out of scope。`SubscriptionTier` /
subscription 系统本身对 economy / billing 仍然有效；本规则只把
**agent-friend 配额** 与 tier 解耦，不移除 subscription 系统。

`MUST NOT`：该 baseline limit 的数值 **不得**在 renderer / Desktop 客户端
hardcode —— renderer 不得把配额常量作为真值来源，不得维护一个
client-side 的 limit 数字（无论是否按 tier 分支）。配额真值的唯一来源是
backend-owned baseline 常量经 admitted 上游投影。

`MUST NOT`：配额达到上限时 Contacts 不得静默丢弃新增请求或投影 generic
error；必须保留 `limit_reached` 的 typed 状态并路由到 manage / remove。

## D-CONTACTS-007 — AgentFriend ↔ LocalAgent One-to-One 与删除联动

`MUST`：每个 AgentFriend 关系对应且仅对应一个 account-scoped LocalAgent
projection（one-to-one），该 projection 的生成 / 修复由 Runtime
`K-AGCORE-139` idempotently 拥有。Contacts 的 `agent_friends` 每一项解析到
这一个 one-to-one LocalAgent 实例。

`MUST`：在 `Contacts` 移除一个 AgentFriend（remove Agent friend）必须删除
其对应的 one-to-one LocalAgent projection。这是 `friend → not_friend`
转移的产品后果，与 `tables/realm-agent-friend-actions.yaml` 中
`friend → not_friend`（guard：*AgentFriend is removed; the one-to-one
LocalAgent projection is deleted*）所编码的语义一致；LocalAgent 的实际终止
由 Runtime `TerminateAgent` 经 `K-AGCORE-139` 的生命周期语义执行。这也与
Realm/Explore 的规则一致：删除一个 AgentFriend 即删除对应的 LocalAgent。

`MUST`：remove Agent friend 触发的 AgentFriend 删除与 LocalAgent
projection 删除必须经 admitted 上游路径（Realm 社交 admission +
`TerminateAgent`）完成；删除是 idempotent 的，重复触发或重试不得产生
不一致的 dangling LocalAgent 或 dangling AgentFriend。

`NOTE`（clarity，不改变上面的转移语义）：AgentFriend 删除与 LocalAgent
projection 删除的联动是 *eventually* 收敛的，不是 synchronous 的。Realm
社交 admission 路径同步删除 `Friendship` 行并在同一事务内写入一条 durable
`LocalAgentTerminationIntent`；该 intent 与 desktop courier 的机制由
Realm `R-SOC-008` 定义。LocalAgent projection 的实际终止由 courier 将
`TerminateAgent` 投递到本机 loopback runtime 后完成。因此
`friend → not_friend` 转移与 `tables/realm-agent-friend-actions.yaml` 中该
guard 表达的 LocalAgent 删除应被理解为经 durable intent + courier 收敛，
而不是后端到 runtime 的同步调用。这是 declared-authority 澄清，不引入
新的转移或新的 Contacts 行为。

`MUST NOT`：Contacts 不得只删除一侧 —— 不得移除 AgentFriend 而保留
orphan LocalAgent，也不得删除 LocalAgent 而保留 dangling AgentFriend。
one-to-one 关系在 Contacts 的移除动作下必须成对失效。

`MUST NOT`：移除 AgentFriend 不得 mutate 对应 RealmAgent 的 canonical
truth；RealmAgent 是 public、world-attached 身份，删除本地 AgentFriend /
LocalAgent 不回写 RealmAgent 真值（与 `D-EXPL-007` 一致）。

## D-CONTACTS-008 — Agent-Friend Chat 即 LocalAgent Chat

`MUST`：`Contacts` 中对 Agent friend 的任何 chat 动作（来自 `agent_friends`
列表项或 relationship detail）必须打开该 one-to-one LocalAgent 实例的
**LocalAgent Chat**，其会话身份必须经 Realm `chat-contract.md` 的
deterministic `localAgentRef`（`R-CHAT-016` ~ `R-CHAT-020`）解析。

`MUST`：当 LocalAgent projection 缺失 / 修复失败 / 非 ready 时，Contacts
必须以 typed 状态呈现，不得伪装 Agent-friend chat 可用。

`MUST NOT`：`Contacts` 在任何状态下都 **不得** 提供对 bare RealmAgent 的
直接 chat / interaction 入口。当前 baseline RealmAgent 不支持 direct
chat；Agent-friend 之后的任何 chat action 都是 LocalAgent Chat，不是
RealmAgent chat（与 `D-EXPL-006` 一致）。

## Fact Sources

- `.nimi/spec/desktop/kernel/tables/contacts-categories.yaml` — 两个 relationship category catalog
- `.nimi/spec/desktop/kernel/tables/contacts-friend-request-states.yaml` — friend request received / sent 状态机
- `.nimi/spec/desktop/kernel/ui-shell-contract.md` — `D-SHELL-001`（导航 tab、`Contacts` core nav）、`D-SHELL-006`（布局结构）、`D-SHELL-032`（Contacts profile branded surface split）；与本契约 placement / 布局 互不重叠
- `.nimi/spec/desktop/kernel/explore-surface-contract.md` — `D-EXPL-001`（Explore 是发现表面，与 Contacts non-overlap）、`D-EXPL-006`（friend-state → primary-action 状态机、`limit_reached`、no bare RealmAgent direct chat）、`D-EXPL-007`（Add friend 双效果、RealmAgent 真值不可变）、`tables/realm-agent-friend-actions.yaml`（`friend → not_friend` 删除联动）
- `.nimi/spec/realm/kernel/social-contract.md` — `R-SOC-001` ~ `R-SOC-006`（Friendship / AgentFriend / friend-request / block canonical 社交真值）
- `.nimi/spec/realm/kernel/chat-contract.md` — `R-CHAT-016` ~ `R-CHAT-020`（deterministic `localAgentRef`、LocalAgent Chat 身份）
- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md` — `K-AGCORE-139`（one idempotent account-scoped LocalAgent projection per AgentFriend）、`TerminateAgent`（LocalAgent 终止生命周期）
