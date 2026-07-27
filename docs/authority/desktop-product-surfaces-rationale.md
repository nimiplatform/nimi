# Desktop Product Surfaces Rationale

> 本文为 rationale/历史散文，非规范权威；规范 = `.nimi/spec/desktop/product-surfaces.authority.yaml`。

## Rationale 完整性对账

### 已收录

- Explore 逐项映射：`D-EXPL-001..014` → `rule.nimi.desktop.product-surfaces.r001..r014`，覆盖统一发现职责、三区闭合集、World 与 source card/detail、source-state action、Runtime materialization handoff、authoring stop-line、invalid-data 与 governance fail-close、World creation 边界及 Explore Open targets。
- Home Feed 逐项映射：`D-HOMEFEED-001..007` → `rule.nimi.desktop.product-surfaces.r015..r021`，覆盖 Realm feed 职责、非 ready entry、与 Nimi Home non-overlap、四个 feed scope、Create Post、SDK typed path 与 no-AI boundary。
- Support 逐项映射：`D-SUP-001..008` → `rule.nimi.desktop.product-surfaces.r022..r029`，覆盖 secondary 独立 surface、五子区、repair/update/diagnostics/logs/recovery owner projection 与 degraded-state reachability。
- Relationship/Profile 主契约映射：`D-REL-001` → `rule.nimi.desktop.product-surfaces.r030`，覆盖 contextual shared profile、admitted social mutation、materialization fail-close 与 no standalone page/sidebar boundary。
- 四张旧机器表均已迁为 `config/desktop-product-surfaces-*.yaml` 非权威配置；Explore sections → `r002`，Home feed scopes → `r018`，relationship categories → `r031`，friend-request states/transitions → `r032`。
- 下文逐字保留四份旧契约散文，供历史 rationale 与逐条核对；现行 canonical 容器为 4 个 definition 加 32 个 rule，共 36 单元。

### 缺失

- 成文后逐句对账未发现四份旧契约中的稳定产品语义遗漏。
- 成文后逐表对账发现旧 `relationship-categories.yaml` 的 human_friends/local_agents 闭合集及消费边界不能只随机器行搬迁，已补入 `r031`。
- 成文后逐表对账发现旧 `relationship-friend-request-states.yaml` 的五状态与四条合法 transition 不能只随机器行搬迁，已补入 `r032`。
- 本轮对账补齐数：2；补齐后缺失：0。

### 有意拒绝

- 旧 `Owner Domain`、`Authority: Desktop Kernel`、章节编号、Fact Sources 列表和文档间解释性优先级属于历史编排与 rationale，不作为新的产品规则；稳定 owner、scope、statement、condition、failure 已进入 canonical 单元。
- 旧表的 `table_family`、`catalog_id`、`machine_id`、label、description 与 guard 文案保留为非权威机器配置；闭合集、产品含义、合法 transition 和 fail-closed 边界已进入 canonical rules，配置不得成为第二套产品 authority。
- Shell navigation order、World Detail layout、Nimi Home enclosing shell、Realm feed truth、Realm social truth、Runtime materialization、Desktop update execution、product-control readiness 与 log retention 等相邻 owner 的真值不在本容器重复；本容器只保留 Desktop product-surface placement、consumer 与 failure stop-line。
- 历史 `D-*` 标识仅在下方 preserved source 中作为 rationale anchor；现行规范稳定标识为 `rule.nimi.desktop.product-surfaces.r001..r032`。

## Normative migration dispositions

- `config/desktop-product-surfaces-*.yaml` 只供实现、测试与 gate 消费；canonical rules 决定 closed set、state transition、owner boundary 与 fail-closed 语义。
- Explore Open 与 source materialization 的既有相邻机器投影继续由其当前表承载，但其 `authority_refs` 重接到本容器的 canonical rule IDs；机器投影不升级为产品 authority。
- Consumer comments, tests, indexes, and gates must reference the canonical container and stable rule IDs rather than deleted Desktop kernel contract paths.

## Preserved source: Explore Surface Contract

# Explore Surface Contract

> Owner Domain: `D-EXPL-*`

## Scope

This contract defines Desktop `Explore` as the Realm discovery surface for
WorldCore and source-core identities. The surface discovers:

- admitted `WorldCore` records;
- `WorldCharacter` source records through their World/detail/source-detail
  route;
- `PersonaCharacter` source records bound to a World;
- public Realm activity from human, persona, and world-character sources.

Desktop Explore does not create WorldCore, WorldCharacter, PersonaCharacter,
Packet v3, or `CharacterSourceRefV3` truth. It does not own Realm feed truth, source
provenance authority, LocalAgent lifecycle, LocalAgent Chat identity, shell
layout, or AI execution.

## D-EXPL-001 — Explore Is The Unified Realm Discovery Surface

`MUST`: `Explore` is the single ordinary Desktop surface for discovering Realm
Worlds, PersonaCharacters, World-bound WorldCharacter sources, and public
activity. The previous standalone World surface is folded into Explore.

`MUST`: primary navigation placement is owned by `D-SHELL-001`; this rule fixes
only the product responsibility of Explore as Realm discovery.

`MUST NOT`: ordinary primary navigation must not keep a standalone World entry
outside Explore. Explore must not become App discovery; App discovery belongs to
the Apps surface. WorldCharacter discovery must use World/detail/source
detail and must not add a fourth Explore section.

## D-EXPL-002 — Explore Sections

`MUST`: Explore has exactly three product sections, with catalog authority in
`tables/explore-sections.yaml`:

| Section | Product responsibility |
|---|---|
| `Worlds` | Browse admitted WorldCore records and enter World detail. |
| `Personas` | Discover PersonaCharacter source records across Worlds. |
| `Activity` | Show admitted public Realm activity from humans, personas, and world characters. |

`MUST NOT`: implementations must not add, remove, or rename these sections
without updating the table and this rule. The three-section meaning must not be
collapsed into an undifferentiated mixed stream.

## D-EXPL-003 — World Card Fields

`MUST`: World cards may present only these product facts from WorldCore or
typed World projection:

- `name`;
- `visual`;
- `lineage` / world type;
- `tagline` / summary;
- `era` / current time label where meaningful;
- `sourceSignal` such as persona or world-character count;
- `activitySignal`;
- `status`.

`MUST`: conditional fields shrink when upstream truth is absent. Explore must
not synthesize empty counts, placeholder era values, or local world facts.

`MUST NOT`: World cards must not read old truth/projection payloads or derive
card facts from local prompt/lore fields. WorldCore and typed World projection
are the only admitted sources for this surface.

## D-EXPL-004 — World Detail Sections

`MUST`: World detail presents these product sections when the corresponding
typed data exists:

- WorldCore overview;
- semantic/world summary;
- scenes, locations, and entry points;
- featured WorldCharacter or PersonaCharacter sources, with a typed
  source-detail route for either kind;
- public activity;
- local materialization availability where relevant;
- governance or status information when useful to ordinary users.

`MUST`: section ordering and responsive layout are owned by `D-SHELL-011` to
`D-SHELL-014`; this rule fixes only the product facts that may appear.

`MUST NOT`: World detail must not expose a Desktop-local source creation entry.
World and persona authoring belong to admitted creator/studio surfaces, not to
ordinary Explore.

## D-EXPL-005 — Character And Persona Source Card Fields

`MUST`: PersonaCharacter and WorldCharacter source cards may present only these
product facts:

- `displayName` / `avatar`;
- `worldOrigin`;
- `sourceKind` and role/category where supplied by core data;
- `concept` / short description;
- `activitySignal` when supplied by Realm feed projection;
- `sourceState`;
- `primaryAction`, derived from `sourceState` by `D-EXPL-006`.

`MUST`: PersonaCharacter discovery enters through the existing `Personas` section.
WorldCharacter discovery enters through World/detail/source-detail. Both
source kinds converge on `D-EXPL-006`; no new Explore section is admitted.

`MUST`: `sourceState` must come from typed core source data plus the bounded
Runtime/SDK `LocalAgentSourceContextStatus` and opaque local-agent
inventory/provenance projection. Unknown/partial status remains a closed local
materialization unavailable state.

`MUST NOT`: Persona cards must not carry relationship state, quota state, direct
source chat, or local conversation readiness as if those were PersonaCharacter
truth.

## D-EXPL-006 — Source State To Primary Action

`MUST`: WorldCharacter and PersonaCharacter primary action is derived from the
source-generic state table `tables/realm-source-materialization-actions.yaml`.

| Source state | Primary action | Result |
|---|---|---|
| `materialization_available` | `Become my partner` / `成为我的伙伴` | Emit only `MaterializeRealmSource(CharacterSourceRefV3, requestId)` for the selected WorldCharacter or PersonaCharacter. Runtime owns account/grant/bearer resolution, Packet v3 acquisition and validation, SnapshotV2, provenance, and LocalAgent identity. |
| `sign_in_required` | `Sign in required` | Disable the action until a current authenticated Realm account exists; do not manufacture an App permission. |
| `source_not_ready` | `Source not ready` | Disable the action while canonical source or dependency readiness is incomplete. |
| `source_access_denied` | `Source unavailable` | Disable the action when Realm visibility or account policy denies materialization; do not infer an alternate authority path. |
| `materializing` | `Materializing` | Disable duplicate actions while Runtime owns the in-flight idempotent transaction. |
| `local_agent_available` | `Open partner` | Open an existing Runtime-owned LocalAgent discovered from Runtime inventory/provenance. |
| `local_agent_ambiguous` | `Open from partners` | Fail closed because Runtime inventory/provenance returned more than one matching partner. |
| `runtime_unavailable` | `Runtime unavailable` | Disable the action because Runtime/SDK/auth inventory is unavailable. |
| `materialization_error` | `Materialization unavailable` | Fail closed with the bounded typed Runtime reason; never synthesize a LocalAgent. |

`MUST`: unavailable source or stale hash states are real fail-closed product
states, not loading placeholders. A new materialization attempt submits a fresh
`requestId` and source ref to Runtime and must not acquire a packet or
synthesize LocalAgent identity from source metadata.
`MUST`: user-facing materialization language is a character/persona
relationship action such as `Become my partner`. Desktop must not present
`Create LocalAgent` or `Create local agent` as the user action.
`MUST`: an existing local-agent state requires Runtime inventory/provenance
read through the SDK/host projection. Desktop may pass the Runtime-owned opaque
`localAgentRef` to Agent Chat, but it must not store token/session custody in
renderer state and must not construct `localAgentRef` from Realm source fields.

`MUST NOT`: Explore must not open LocalAgent Chat directly from a bare
Realm source. LocalAgent Chat requires a Runtime-owned LocalAgent with
opaque identity; source provenance alone is not executable LocalAgent identity.

Desktop consumes only bounded `LocalAgentSourceContextStatus`; it does not
receive source snapshot content, packet/proof, raw diagnostics, prompt, or
context. It never supplies a caller-selected audience, prompt/context, or
LocalAgent identity to materialization.

- AUTHORITY-RELATION subject=desktop action=consume-status object=localagent-source value=bounded-only polarity=require
- AUTHORITY-RELATION subject=desktop-materialization-actions action=set-authority object=source-materialization value=source-generic polarity=require

## D-EXPL-007 — Source Materialization Handoff

`MUST`: When a user chooses a WorldCharacter or PersonaCharacter source,
Desktop Explore may only emit a local materialization handoff intent. The
handoff contains exactly a canonical `CharacterSourceRefV3` and bounded
`requestId`. Runtime owns current account/grant/bearer resolution, challenge,
Packet v3 acquisition, strict validation, `LocalAgentSourceSnapshotV2`, v3
provenance, and atomic LocalAgent creation; the handoff is not a relationship
mutation, durable Realm connection, packet DTO, or LocalAgent creation.

`MUST`: Packet v3 materialization is consumed privately by Runtime under
`K-AGCORE-139`. LocalAgent deletion/reset is Runtime-local under
`K-AGCORE-141`. Source removal does not delete LocalAgent state. Explore may
show their state but must not implement them as renderer-local truth.

`MUST NOT`: Explore must not fabricate a LocalAgent, write back to the source,
fix or replace the Runtime-issued audience, attach prompt/context, or infer
source readiness from cached card data.

## D-EXPL-008 — No Desktop Source Creation Entry

`MUST`: Desktop Explore is not a source authoring workbench. PersonaCharacter and
WorldCharacter creation, import, generation, review, publish, and audit
belong to admitted studio/forge paths.

`MUST`: if a creator/studio link is admitted later, it must leave Explore as a
typed external action and return only after core truth has been written by the
owning surface.

`MUST NOT`: Explore must not parse imported persona files, run source
generation, or submit core truth writes.

## D-EXPL-009 — No Local Persona Field Schema

`MUST`: Explore does not define a local minimum field schema for persona
creation. Field authority lives in Realm core/creator contracts and their
studio surfaces.

`MUST NOT`: Explore must not keep a parallel draft schema that can be mistaken
for Realm core truth.

## D-EXPL-010 — No Draft Truth Write

`MUST`: Any source data shown by Explore before Realm acceptance is display-only
or handoff-only. It is not Realm truth and cannot be submitted by Explore.

`MUST NOT`: Explore must not project import/generation candidates as accepted
Realm source records, and must not present generic success for a source write it
does not own.

## D-EXPL-011 — Invalid Data Fails Closed

`MUST`: missing or invalid typed fields must fail closed with a typed state or
shrink the affected optional surface. User-visible cards must not be completed
with guessed names, counts, worlds, avatars, or activity.

`MUST NOT`: Explore must not silently coerce unsupported source fields into
card truth or local materialization truth.

Unknown or partial `LocalAgentSourceContextStatus` schema, enum, state, source
kind, reason, or coverage branch is an unavailable/failed state and never a
materialization-ready or local-agent-ready state.

## D-EXPL-012 — Source Governance Boundaries

`MUST`: Explore consumes World policy, source visibility, account capability,
moderation, quota, and audit outcomes only through admitted typed projections.

`MUST NOT`: Explore must not bypass world policy, source visibility,
moderation, quota, audit, or core ownership rules by issuing renderer-local
mutations.

Desktop receives no raw source/world snapshot, packet/proof, prompt/lane,
memory, or context authority through governance projections. Bounded status is
presentation input only.

## D-EXPL-013 — World Creation Is Not Ordinary Explore Behavior

`MUST`: World creation remains a controlled creator/studio path. Ordinary
Explore users may discover Worlds and sources; they do not create Worlds from
Explore.

`MUST NOT`: any Explore section may expose free World creation or local source
creation as an ordinary Desktop action.

## D-EXPL-014 - Explore Open Targets

Desktop Explore owns the admitted section and `productIntent` pairings for
Desktop Open Intent. Platform `P-DOPEN-*` may reference
`tables/explore-open-targets.yaml`, but it must not duplicate Explore section
or product-intent truth.

Admitted v1 pairings are:

- `worlds` with optional `discover-worlds`
- `personas` with optional `discover-personas` or `select-partner`
- `activity` with optional `view-activity`

Invalid section/productIntent pairings fail closed as
`desktop-open-target-unsupported`. Explore Open Intent must not create
WorldCore, PersonaCharacter, Packet v3, or LocalAgent truth.
WorldCharacter source materialization remains reachable through a selected
World/detail/source-detail path; it does not add a section/productIntent pair.

## Fact Sources

- `config/desktop-product-surfaces-explore-sections.yaml` — Explore section catalog.
- `config/desktop-open-targets.yaml` — Explore Desktop Open target and productIntent catalog.
- `.nimi/spec/desktop/product-surfaces.authority.yaml` — source-generic WorldCharacter/PersonaCharacter state-to-action table.
- `.nimi/spec/desktop/shell-ui.authority.yaml` — navigation, World Detail layout, and Apps surface boundary.
- `.nimi/spec/sdks/realm-consumer.authority.yaml` — external Realm consumer boundary and current generated API floor.
- `.nimi/spec/sdks/realm-consumer.authority.yaml` — current World/Character generated-core projection boundary.
- `.nimi/spec/runtime/agent-service.authority.yaml` — Packet v3 to SnapshotV2/LocalAgent materialization and Runtime-local deletion.

## Preserved source: Home Feed Contract

# Home Feed Contract

> Owner Domain: `D-HOMEFEED-*`

## Scope

定义 Desktop primary-navigation `Home` tab 作为 **Realm feed 表面** 的产品
语义内核：`home` tab 渲染 Realm feed surface、四个 feed scope
（`personal` / `friends` / `persona_activity` / `world_character_activity`）
的呈现、Create Post affordance、
SDK-typed Realm feed projection 的消费边界、以及 `Home` 与 `Nimi Home`
installed shell（`D-HOME-*`）的显式 non-overlap。

本契约只拥有 **`Home` feed 表面产品语义** authority：`home` tab 呈现什么、
哪些 feed scope 存在、Create Post 入口如何呈现、feed 数据如何被消费。它
**不拥有**：

- shell 导航 tab 体系、布局、路由分包、windowing —— 由
  `.nimi/spec/desktop/shell-ui.authority.yaml` 拥有；
- Realm Post / Feed canonical 真值、feed scope 投影语义、Create Post
  truth-write admission —— 由 Realm `feed-contract.md`（`R-FEED-001` ~
  `R-FEED-010`）拥有；
- Friendship / core source relationship admission —— 由 Realm
  `social-contract.md` 与 `R-CORE-010` 拥有；
- `Nimi Home` installed shell 的 hosted-shell IA、first-run / return-run
  state machine、surface registry、Apps placement —— 由
  `.nimi/spec/desktop/shell-ui.authority.yaml` `rule.nimi.desktop.shell-ui.r049..r061` 拥有；
- Realm discovery（Worlds / PersonaCharacter sources / public activity 发现）—— 由
  `explore-surface-contract.md`（`D-EXPL-001` ~ `D-EXPL-013`）拥有。

本契约只把上述上游真值在 `Home` feed 产品表面上 **如何被呈现、消费、触发**
固定下来；任何与上述契约冲突的解读以上游契约为准。

## D-HOMEFEED-001 — `Home` Tab 是 Realm Feed 表面

`MUST`：Desktop primary navigation 的 `home` tab 渲染 **Realm feed 表面**。
`Home` 表面呈现 Realm 公共活动 feed 与 Create Post 入口；它是 ordinary
primary navigation `Home | Chat | Characters | Explore | Apps | Runtime` 中的
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
（installed product shell、`rule.nimi.desktop.shell-ui.r049..r061` / canonical
shell UI authority）是两个不同的产品对象，必须显式 non-overlap：

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

## D-HOMEFEED-004 — Feed Scope 呈现

`MUST`：`Home` feed 表面必须呈现 Realm `feed-contract.md`（`R-FEED-005`）
定义的 canonical feed scope，呈现事实源为
`tables/home-feed-scopes.yaml`：

| Scope | `Home` 表面呈现职责 |
|---|---|
| `personal` | 呈现 viewer 本人发布的 Post。 |
| `friends` | 呈现 viewer 的 ACTIVE human friends 发布的、对 viewer 可见的 Post。 |
| `persona_activity` | 呈现 PersonaCharacter 发布的 public activity Post。 |
| `world_character_activity` | 呈现明确准入的 WorldCharacter public activity Post。 |

`MUST`：feed scope 的投影语义、可见性过滤、author 归属由 Realm
`R-FEED-005` ~ `R-FEED-007` 拥有；本规则只固定 `Home` 表面必须呈现且区分
这些 scope。

`MUST NOT`：`Home` feed 表面不得新增、删除、或重命名 feed scope 而不更新
`tables/home-feed-scopes.yaml` 与本规则；不得把 feed scopes 压缩成无区分的
单一混合流而丢失 scope 语义；不得把 LocalAgent 私有 activity 当作
Realm feed 内容呈现（`R-FEED-007`）。

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
路径上调用 Runtime AI execution。PersonaCharacter / WorldCharacter public
activity 内容如何生成不在本契约范围（`R-FEED-010`）。

## Fact Sources

- `config/desktop-product-surfaces-home-feed-scopes.yaml` — `Home` 表面 feed scope 呈现 catalog
- `.nimi/spec/desktop/shell-ui.authority.yaml` — `Nimi Home` installed shell 与 primary navigation tab placement
- `.nimi/spec/desktop/product-surfaces.authority.yaml` — `D-EXPL-001` ~ `D-EXPL-013`（Realm discovery；与 `Home` feed 表面互不重叠）

## Preserved source: Support Surface Contract

# Support Surface Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop `Support` 表面的产品语义。`Support` 是一个独立的 secondary 系统
表面，承载 repair、updates、diagnostics、logs/export、recovery help 五个子区。

`Support` 不是 ordinary primary navigation tab。普通用户 primary navigation 固定
为 `Home | Chat | Characters | Explore | Apps | Runtime`（`D-SHELL-001`）。
`Support` 与 `Settings` 一样属于 Secondary/System 分组：可由菜单、账户区或
Settings 入口打开，但不得作为额外的 primary nav 项。

`Support` 是一个**独立 surface**（与 Settings 平级），不是 Settings 内的一组
section。manual 将 `Support` 与 `Settings` 列为平级 §-级标题，acceptance
scenario 14 也将二者列为各自独立的非 primary 类别。独立 surface 也保证 repair /
recovery 在 Settings preference 状态本身损坏时仍可达。

不拥有：

- self-update / release 真值与更新执行机制（`.nimi/spec/desktop/shell-runtime.authority.yaml`
  `rule.nimi.desktop.shell-runtime.r066..r072`，`P-SUPD-*`）；Support 只投影并触发其受管 command。
- `~/.nimi` config 迁移与修复执行（`P-MIG-*`）；Support repair 子区只调用
  `P-MIG-*` 修复流程，不重定义它。
- Runtime diagnostic / log / audit 真值（Runtime kernel）；Support 只消费其
  typed projection。
- product-control first-run 状态机（`P-COLD-*`）。

## D-SUP-001 — Support As Secondary System Surface

`MUST`：`Support` 必须注册为 `config/desktop-shell-ui-app-tabs.yaml` 中
`nav_group: secondary` 的非权威机器投影表面，与 `settings` 平级。它必须可从菜单 / 账户区 / Settings 入口到达。

`MUST NOT`：`Support` 不得进入 `getCoreNavItems()` 的 core 导航；ordinary
primary navigation 必须保持 `.nimi/spec/desktop/shell-ui.authority.yaml`
`rule.nimi.desktop.shell-ui.r001` 的六项闭合集。`Support`、其子区（repair / updates /
diagnostics / logs / recovery）均不得作为 primary ordinary 产品类别。

## D-SUP-002 — Support Sub-Area Set

`MUST`：`Support` 表面必须承载且仅承载以下五个子区，对应 manual §Support：

1. `repair` — 配置 / 数据根 / 依赖修复入口。
2. `updates` — Desktop 应用更新与 independently installed Runtime service
   compatibility / repair 状态投影。
3. `diagnostics` — 技术诊断聚合视图。
4. `logs` — 日志查看与导出。
5. `recovery` — 恢复帮助 / 引导。

`MUST NOT`：`Support` 不得承载 ordinary preference 设置（account / language /
appearance / notifications 等）——这些归 `Settings`。`Support` 不得成为
developer surface 的入口——developer surface 归 `D-DEV-*`。

## D-SUP-003 — Repair Sub-Area

`MUST`：`repair` 子区必须将修复动作委托给 `P-MIG-*` 的修复流程与 `P-COLD-*`
的 product-control 修复状态。它必须能够呈现并触发：

- `~/.nimi` governed config 文件的 `repair_required` / `blocked` 修复
  （`P-MIG-004`）。
- broken-pointer 修复（`P-MIG-004` / `P-MIG-005`），且永不孤立既有数据。
- `nimi_data` data-root 修复 / 迁移入口（`P-MIG-007`）。

`MUST NOT`：`repair` 子区不得自行实现 schema 迁移、pointer 重建或数据搬运
逻辑；不得在无 impact preview 的前提下执行任何会删除或孤立用户数据的修复
（`P-MIG-005` / `P-MIG-008`）。

## D-SUP-004 — Updates Sub-Area

`MUST`：`updates` 子区是 `.nimi/spec/desktop/shell-runtime.authority.yaml` self-update plane 假定的
Application Update 宿主表面。它必须消费 `DesktopReleaseInfo` 投影并展示当前
desktop release、target desktop release 与 updater state；当前 verified Runtime
service release、mutual compatibility 与 repair state 必须来自 protected-local
service status 投影，不能来自 Desktop manifest。Desktop update 动作通过受管
Tauri update command（`desktop_update_*`）触发，Runtime service update/repair
保持独立的 signed service-updater authority。

`MUST`：当 `updaterAvailable=false` 时，静默检查必须 no-op；手动更新动作必须
直接展示 `updaterUnavailableReason`，不得调用已知会失败的 updater command。

`MUST NOT`：`updates` 子区不得在 renderer 侧合成默认 version 信息、不得由
fallback version info 掩盖 release metadata、Runtime trust/compatibility 或
service repair 错误；不得展示 bundled/staged Runtime path，因为该产品路径不
存在。

## D-SUP-005 — Diagnostics Sub-Area

`MUST`：`diagnostics` 子区必须将分散的 feature-local 诊断聚合为一个统一的
technical diagnostics 视图，消费 Runtime / SDK 暴露的 typed diagnostic
projection（daemon lifecycle、host capability profile、dependency job state、
selected source record projection）。

`MUST NOT`：`diagnostics` 子区不得拥有 Runtime diagnostic / log / audit 真值，
不得绕过 typed projection 直接读取 runtime 内部状态，不得把 ordinary-user
正常使用路径建立在诊断视图之上。

## D-SUP-006 — Logs And Export Sub-Area

`MUST`：`logs` 子区必须提供日志查看与日志导出。它消费
`config/desktop-shell-ui-log-areas.yaml` 的非权威日志区机器投影与 `nimi_data`
data-root 下的 `logs/` 目录（`P-MIG-006`
`logs` 行：owner `runtime_product_support`，可导出供 support 使用）。

`MUST`：日志导出必须产出一个用户可定位的导出工件；导出失败时必须 fail-closed
呈现 typed 失败，不得静默产出空文件或伪成功工件。

`MUST NOT`：`logs` 子区不得篡改或删除 `logs/` 目录内容来"清理"——日志保留与
清理遵守 `P-MIG-006` 的 `logs` 行 cleanup rule（retention policy）。

## D-SUP-007 — Recovery Help Sub-Area

`MUST`：`recovery` 子区必须提供恢复帮助：在 `~/.nimi` 损坏、`nimi_data`
缺失 / 不可达、或 first-run 未完成等 fail-closed 场景下，向用户呈现指向 repair
子区与 first-run / setup 状态的恢复引导。

`MUST`：recovery 引导必须使用 `P-COLD-001` 的 typed fail-closed 状态语义与
`first-run-state-machine.yaml` 的 copy floor，不得展示技术 enum 名作为主要
用户文案。

`MUST NOT`：`recovery` 子区不得自行声称已恢复 readiness——readiness 真值仍由
product-control record（`P-COLD-015` / `P-COLD-016`）admission 决定。

## D-SUP-008 — Support Reachability Under Degraded State

`MUST`：`Support` 表面（至少 repair 与 recovery 子区）必须在 Settings
preference 状态本身损坏、或 ordinary shell 因 fail-closed 状态不可进入时仍然
可达。Support 的可达性不得依赖 ordinary shell readiness。

`MUST NOT`：`Support` 不得只在 `ready_for_use` 之后才可达；它必须是 fail-closed
状态下用户的一等恢复入口。

## Fact Sources

- `.nimi/spec/desktop/shell-ui.authority.yaml` — shell navigation, Developer Tools, and telemetry semantics
- `.nimi/spec/desktop/shell-runtime.authority.yaml` — `rule.nimi.desktop.shell-runtime.r066..r072`
- `config/desktop-shell-ui-app-tabs.yaml` — non-authoritative machine projection
- `config/desktop-shell-ui-log-areas.yaml` — non-authoritative machine projection
- `.nimi/spec/platform/product-lifecycle.authority.yaml` — `P-MIG-001..P-MIG-008`
- `.nimi/spec/platform/product-lifecycle.authority.yaml` — `P-COLD-001`, `P-COLD-009..P-COLD-016`
- `config/platform-first-run-state-machine.yaml`
- `config/platform-nimi-data-directory-ownership.yaml`

## Preserved source: Relationship And Profile Surface Contract

# Relationship And Profile Surface Contract

> Owner Domain: `D-REL-*`

## Scope

Desktop relationship/profile UX is contextual. It is consumed by Home, Chat,
Explore, Profile, notification, and local materialization flows; it is not a
standalone primary navigation product surface.

This contract owns Desktop placement and reuse rules for relationship/profile
components. It does not own shell navigation, Realm discovery, Friendship
truth, source provenance authority, Packet v3 materialization,
or LocalAgent Chat identity.

## D-REL-001 — Contextual Relationship/Profile Surface

`MUST`: Human and source profile detail remains available through shared
profile detail modal and shared profile detail content components. Home,
Explore, Chat, Profile, and notification consumers may open that modal directly
without depending on a standalone relationship-management page.

`MUST`: Social mutations such as remove friend, block, unblock, accept/reject
friend request, and local materialization handoff must use admitted Realm
social/core and Runtime paths. Desktop must not create renderer-local social
truth, pseudo-success, REST bypass, or bare source direct chat.

`MUST`: Local materialization pending, unavailable, or unsupported states must
fail closed or route to an admitted in-context management action. They must not
require a standalone primary relationship-management page.

`MUST NOT`: Desktop shell must not expose relationship management as an
ordinary primary nav tab, lazy route, E2E page journey, governed page shell, or
sidebar surface.

`MUST NOT`: Removing a standalone page must not delete or hide reusable
human/source profile modal behavior from contextual consumers.

## Fact Sources

- `config/desktop-shell-ui-app-tabs.yaml` — non-authoritative Desktop app-tab machine projection.
- `config/desktop-shell-ui-renderer-design-overlays.yaml` — non-authoritative shared
  profile detail modal overlay governance.
- `config/desktop-product-surfaces-relationship-categories.yaml` — contextual
  relationship/source categories.
- `.nimi/spec/desktop/product-surfaces.authority.yaml` — PersonaCharacter
  discovery and source-state primary actions.
- `.nimi/spec/sdks/realm-consumer.authority.yaml` — external Realm social and typed source consumer boundary.
- `.nimi/spec/runtime/agent-service.authority.yaml` — Packet v3/SnapshotV2 materialization and Runtime-local LocalAgent lifecycle.
