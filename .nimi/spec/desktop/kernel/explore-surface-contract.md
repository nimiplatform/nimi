# Explore Surface Contract

> Owner Domain: `D-EXPL-*`

## Scope

定义 Desktop `Explore` 作为 Realm 发现表面的产品语义内核：四区结构
（Worlds / Agents / Activity / Create Agent）、World card 与 World detail
的产品字段语义、RealmAgent card 与 friend-state → primary-action 模型、
以及 lightweight RealmAgent creation（manual / Character Card import /
AI-assisted）的 draft-before-truth 规则。

本契约只拥有 **Explore 产品语义** authority：哪些区存在、card 上呈现什么
产品事实、friend-state 决定什么 primary action、creation 草稿何时写入
Realm 真值。它 **不拥有**：

- shell 导航 tab 体系、布局、路由分包、World Detail 视觉分区顺序 —— 由
  `ui-shell-contract.md`（`D-SHELL-001`、`D-SHELL-011` ~ `D-SHELL-014`）拥有；
- Friendship / AgentFriend canonical 社交 admission 真值 —— 由 Realm
  `social-contract.md`（`R-SOC-001` ~ `R-SOC-006`）拥有；
- LocalAgent projection 的 Runtime 生成 / 修复语义 —— 由
  `runtime-agent-service-contract.md`（`K-AGCORE-139`）拥有；
- LocalAgent Chat 的 `localAgentRef` 身份与会话真值 —— 由 Realm
  `chat-contract.md`（`R-CHAT-016` ~ `R-CHAT-020`）拥有；
- World canonical context / semantic truth、World creation admission ——
  由 Realm world kernel 契约拥有；
- AI execution scope —— 由 `ai-scope-contract.md`（`P-AISC-001` ~
  `P-AISC-006`）拥有。

本契约只把上述上游真值在 Explore 产品表面上 **如何被发现、呈现、触发**
固定下来；任何与上述契约冲突的解读以上游契约为准。

## D-EXPL-001 — Explore 是统一 Realm 发现表面

`MUST`：`Explore` 是 Realm 内容（Worlds、RealmAgents、public activity、
RealmAgent 创建入口）的唯一统一发现表面。Desktop 既有的独立 `World`
页面与 World detail 路由必须折入 `Explore`。

`MUST`：`Explore` primary navigation 入口由 `D-SHELL-001` 拥有；本规则只
固定其产品职责为 Realm discovery。

`MUST NOT`：不得在 ordinary primary navigation 中保留独立于 `Explore` 的
`World` 入口。`Explore` 当前阶段不得承载 App / Nimi App / Mod / Extension
发现 —— App discovery 属于 `Apps` 表面（`D-HOME-004`），不在本契约范围。

`MUST NOT`：不得把 `Explore` 退化成单一列表而丢失下述四区的语义区分。

## D-EXPL-002 — Explore 四区结构

`MUST`：`Explore` 的产品结构固定为四个 section，语义事实源为
`tables/explore-sections.yaml`：

| Section | 产品职责 |
|---|---|
| `Worlds` | 浏览 admitted Realm Worlds，并进入 World detail。 |
| `Agents` | 跨 Worlds 发现 RealmAgents。 |
| `Activity` | 在 admitted 范围内呈现来自 Worlds、friends、Agents 的 public Realm activity。 |
| `Create Agent` | 在选定 World 内进行 lightweight RealmAgent creation。 |

`MUST`：`Create Agent` 是发现表面内的创建入口，其创建流程的实际执行受
`D-EXPL-008` ~ `D-EXPL-012` 约束。

`MUST NOT`：不得新增、删除、或重命名 section 而不更新
`tables/explore-sections.yaml` 与本规则；不得把 four-section 语义压缩为
无区分的混合流。

## D-EXPL-003 — World Card 字段语义

`MUST`：World card 必须只呈现下述产品字段语义（具体视觉编排由
`D-SHELL-*` 拥有，本规则只锁定产品字段集合）：

- `name`：World 名称；
- `visual`：banner / 视觉标识；
- `lineage`：type 或 lineage（世界类型 / 谱系）；
- `tagline`：tagline / summary 摘要；
- `era`：当前 time / era（仅当对该 World 有意义时）；
- `agentSignal`：agent count 或 featured agents；
- `activitySignal`：public activity 信号；
- `status`：当 World 非 fully active 时的状态。

`MUST`：World card 的 `era`、`agentSignal`、`activitySignal`、`status`
属于条件字段；当上游真值不存在时按缺失收缩呈现，不得保留空占位、不得
合成占位值。

`MUST NOT`：World card 不得呈现 World canonical context / semantic truth
的派生字段作为 card 真值来源；card 只消费 Realm world 投影，不得在
Explore 层自创 World 真值。

## D-EXPL-004 — World Detail 区段与创建入口

`MUST`：World detail 必须呈现下述产品 section 语义集合（section 大区块
顺序与确定性布局由 `D-SHELL-011` ~ `D-SHELL-014` 拥有，本规则只锁定
产品语义集合）：

- world overview；
- world rules / semantic truth summary；
- scenes / locations / entry points；
- featured RealmAgents；
- public activity；
- creation affordance —— 仅当该 World admits user-created RealmAgents 时呈现；
- governance / status information —— 仅在对 ordinary users 有用时呈现。

`MUST`：World detail 的 creation affordance 是 **条件入口**：只有当该
World 的策略 admits user-created RealmAgents 时才呈现，且其触发路径必须
进入 `D-EXPL-008` 定义的 lightweight RealmAgent creation 流程。

`MUST NOT`：当 World 不 admit user-created RealmAgents 时，不得呈现可点击
的 creation affordance，也不得呈现“伪装可用、点击后报错”的占位入口 ——
缺失必须 fail-closed 收缩，不渲染该入口。

## D-EXPL-005 — RealmAgent Card 字段语义

`MUST`：RealmAgent card 必须只呈现下述产品字段语义：

- `name` / `avatar`：名称与头像；
- `worldOrigin`：所属 World 来源（每个 RealmAgent 必须属于一个 World）；
- `category`：role / category；
- `concept`：short bio / concept 概念摘要；
- `activitySignal`：public activity / post count（当可用时）；
- `friendState`：当前账号对该 RealmAgent 的 friend 状态；
- `primaryAction`：由 `friendState` 派生的 primary action（见 `D-EXPL-006`）。

`MUST`：`friendState` 与 `primaryAction` 必须来自 Realm 社交真值投影
（`R-SOC-001` ~ `R-SOC-002` 的 AgentFriend / Friendship 投影），不得在
Explore 层自持平行 friend 真值。

`MUST NOT`：RealmAgent card 的 `activitySignal` 在上游计数不存在时不得
合成数字 / 占位值；缺失按缺失呈现。

## D-EXPL-006 — Friend-State → Primary-Action 模型

`MUST`：RealmAgent card 的 primary action 必须由 friend-state 确定性派生，
状态机事实源为 `tables/realm-agent-friend-actions.yaml`：

| Friend state | Primary action | Result 语义 |
|---|---|---|
| `not_friend` | `Add friend` | 创建 / 发起 AgentFriend 关系；current baseline 在未超限时 auto-approve（见 `D-EXPL-007`）。 |
| `pending` | `Pending`（非可重复触发） | 不得产生重复 friend request。 |
| `friend` | `Open Agent Chat` | 打开该 one-to-one LocalAgent 实例的 **LocalAgent Chat**。 |
| `limit_reached` | `Manage Agent friends` | 用户必须移除某个 AgentFriend，或在后续 admitted 时升级配额。 |

`MUST`：`friend` 状态下的 `Open Agent Chat` 必须打开 LocalAgent Chat，其
会话身份必须经由 Realm `chat-contract.md` 的 deterministic `localAgentRef`
（`R-CHAT-016` ~ `R-CHAT-020`）解析。

`MUST NOT`：RealmAgent card 在任何 friend-state 下都 **不得** 提供对
RealmAgent 的直接 chat / interaction 入口。当前 baseline RealmAgent 不
支持 direct chat；friendship 之后的任何 chat action 都是 LocalAgent Chat，
不是 RealmAgent chat。

`MUST NOT`：不得把 `pending` / `limit_reached` 压缩成 generic
`unavailable`，必须保留 typed distinction。

## D-EXPL-007 — Add Friend 的双效果与 RealmAgent 真值不可变

`MUST`：对 RealmAgent 执行 `Add friend` 必须产生两个效果，且两者都通过
admitted 上游路径完成：

1. 创建 AgentFriend 关系 —— 这是 Realm 社交真值（`R-SOC-001` ~
   `R-SOC-005` 拥有的 ordinary Friendship row，无特权 Agent class）；
2. 创建对应的 idempotent account-scoped LocalAgent projection —— 由
   Runtime `K-AGCORE-139` 拥有。每个 AgentFriend 对应且仅对应一个
   LocalAgent projection（one-to-one）。

`MUST`：这就是当前 baseline 的 "fork" 产品行为：把一个 RealmAgent 加为
friend 即把它 fork 成账号本地的 LocalAgent。LocalAgent projection 的生成
与修复必须是 idempotent 的（`K-AGCORE-139`）—— Explore 重复触发或重试
不得产生第二个 LocalAgent。

`MUST NOT`：`Add friend` 不得 mutate RealmAgent 的 canonical truth。
RealmAgent 是 public、world-attached、owner-created 身份；fork 出的
LocalAgent 的本地 evolution（memory / cognition）也不得回写 RealmAgent
真值，除非经显式 publish 路径（不在本契约范围）。

`MUST NOT`：Explore 不得在 LocalAgent projection 缺失 / 修复失败时把
`friend` 状态投影为可直接 `Open Agent Chat`；上游 projection 非 ready 时
必须 fail-closed 呈现 typed 状态，不得伪装会话可用。

## D-EXPL-008 — Lightweight RealmAgent Creation 入口与模式

`MUST`：lightweight RealmAgent creation 的产品入口固定为：

```text
Explore -> World detail -> Create Agent
```

创建始终发生在一个 **选定的 World 内**；不存在无 World 归属的 RealmAgent
创建。

`MUST`：creation 固定支持三种模式，事实源为
`tables/realm-agent-creation-modes.yaml`：

| Mode | 产品行为 |
|---|---|
| `manual_quick_create` | 用户直接填写核心字段。 |
| `character_card_import` | 用户导入 Character Card 风格文件；Nimi 本地解析、映射字段、并进入 review。 |
| `ai_assisted_generation` | 用户描述概念；Nimi 生成 candidate 并进入 review。 |

`MUST`：`character_card_import` 与 `ai_assisted_generation` 在可适用处必须
复用 admitted 的 Forge / import 语义，不得自建平行解析 / 生成栈。

`MUST`：`ai_assisted_generation` 的任何 AI execution path 必须显式携带
`AIScopeRef`（`P-AISC-001`、`P-AISC-004`）；不得在 Explore 层无 scope
调用 Runtime AI execution。

`MUST NOT`：lightweight creation 不得取代 Forge。Forge 仍是 richer
World / Agent 创作与发布的 heavy creator workbench；本契约的 lightweight
creation 只服务 fast ordinary RealmAgent creation。

## D-EXPL-009 — RealmAgent Creation 最小字段集

`MUST`：RealmAgent creation 的最小产品字段集固定为下述集合，事实源为
`tables/realm-agent-creation-fields.yaml`：

- `selectedWorld`：所属 World（必填，来自入口 World detail 上下文）；
- `handle`：handle；
- `displayName`：display name；
- `concept`：concept；
- `description`：description / bio；
- `scenario`：scenario；
- `greeting`：greeting；
- `avatar`：avatar / reference image；
- `wakeStrategy`：wake strategy；
- `primaryTrait`：primary trait；
- `secondaryTraits`：optional secondary traits；
- `visibility`：visibility / publish posture（仅在 admitted 处）。

`MUST`：三种 creation mode 都必须最终落到同一最小字段集；import / generation
模式只是字段的不同填充来源，不得绕过任一必填字段。

`MUST NOT`：不得新增、删除最小字段而不更新
`tables/realm-agent-creation-fields.yaml` 与本规则。

## D-EXPL-010 — Draft-Before-Realm-Truth-Write

`MUST`：imported 或 generated 的 RealmAgent 数据在用户 review 并确认
之前是 **draft**，不是 Realm 真值。提交前 Nimi 必须显式向用户呈现
“哪些内容将成为 Realm truth”。

`MUST`：creation 提交（draft → Realm truth write）必须是一次显式的、
经用户确认的动作；manual / import / generation 三种模式都遵循同一
draft-review-confirm 顺序。

`MUST NOT`：不得在用户 review + confirm 之前把 imported / generated 数据
写入 Realm 真值；不得跳过 review 步骤直接提交 import / generation 结果。

## D-EXPL-011 — Invalid 字段告警与失败可恢复

`MUST`：invalid 或 unsupported 的 imported 字段必须以 **warning** 形式
呈现给用户，并保留在 draft 内供用户处理。

`MUST`：creation 失败时必须保留 draft 可恢复 —— 用户的输入 / import /
generation 结果不得因一次失败而丢失。

`MUST NOT`：不得 **silently** 写入 invalid / unsupported 字段；不得用
猜测值、占位值、或 fabricated 字段填补 invalid 字段后伪装成功；不得在
creation 失败后投影 generic success 或 "unchanged" 成功。

## D-EXPL-012 — Creation 受 World 策略与 Realm 治理约束

`MUST`：RealmAgent creation 必须遵循下述上游约束，任一不满足都按 typed
fail-closed 状态呈现：

- World policy —— 该 World 是否 admits user-created RealmAgents（见
  `D-EXPL-004`、`D-EXPL-013`）；
- user capabilities —— 当前账号是否具备创建能力；
- moderation rules —— Realm 内容审核规则；
- quota / limits —— 创建配额与上限；
- Realm audit —— 创建必须进入 Realm 审计轨迹。

`MUST NOT`：Explore 不得在客户端绕过 World policy / capability / moderation
/ quota / audit 而直接写入 RealmAgent 真值；不得把上述任一约束失败压缩
成无区分的 generic error，必须保留 typed distinction。

## D-EXPL-013 — World Creation 非 Ordinary 用户行为

`MUST`：World 是 Realm-owned canonical context / truth domain。World
creation 只允许 controlled / admitted 创建路径，不是 ordinary open-user
产品行为。

`MUST`：`Explore` 对 ordinary 用户只暴露 **在 admitted World 内创建
RealmAgent** 的能力（`D-EXPL-008`），不暴露自由创建 World 的入口。

`MUST NOT`：`Explore` 任何 section（包含 `Worlds`、`Create Agent`）都
不得向 ordinary 用户提供自由 World 创建入口；World creation admission
真值由 Realm world kernel 契约拥有，不在本契约范围。

## Fact Sources

- `.nimi/spec/desktop/kernel/tables/explore-sections.yaml` — Explore 四区 catalog
- `.nimi/spec/desktop/kernel/tables/realm-agent-friend-actions.yaml` — friend-state → primary-action 状态机
- `.nimi/spec/desktop/kernel/tables/realm-agent-creation-modes.yaml` — creation modes catalog
- `.nimi/spec/desktop/kernel/tables/realm-agent-creation-fields.yaml` — creation 最小字段集 catalog
- `.nimi/spec/desktop/kernel/ui-shell-contract.md` — `D-SHELL-001`（导航 tab、`World` 折入 `Explore`）、`D-SHELL-011` ~ `D-SHELL-014`（World Detail 布局）；与本契约 placement / 布局 互不重叠
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — `D-HOME-004`（Apps 表面，App discovery 不属 Explore）
- `.nimi/spec/realm/kernel/social-contract.md` — `R-SOC-001` ~ `R-SOC-006`（Friendship / AgentFriend canonical 真值）
- `.nimi/spec/realm/kernel/chat-contract.md` — `R-CHAT-016` ~ `R-CHAT-020`（deterministic `localAgentRef`、LocalAgent Chat 身份）
- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md` — `K-AGCORE-139`（one idempotent account-scoped LocalAgent projection per AgentFriend）
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001` ~ `P-AISC-006`（AI-assisted generation 的 `AIScopeRef`）
