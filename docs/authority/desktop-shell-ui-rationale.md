# Desktop Shell UI Rationale

> 本文为 rationale/历史散文，非规范权威；规范 = `.nimi/spec/desktop/shell-ui.authority.yaml`。

## Rationale 完整性对账

### 已收录

- UI 壳逐项映射：`D-SHELL-001` → `r001..r002`；`D-SHELL-002..009` → `r003..r010`；`D-SHELL-011` → `r011`；`D-SHELL-012` → `r012,r098`；`D-SHELL-013` → `r013,r099`；`D-SHELL-014..039` → `r014..r039`。这组规则覆盖导航、布局、host mode、i18n、World Detail 的区块与卡片内布局、共享设计 baseline、material、Chat/Profile 边界、attention、obstacle flow、local-app launch 与 Desktop Open。
- Kit 消费逐项映射：`D-SHELL-090..098` → `r040..r048`，覆盖 Desktop-local inventory 边界、theme entry、controlled exception、Chat/Avatar/Agent Center consumer stop-line。
- Nimi Home 逐项映射：`D-HOME-001..013` → `r049..r061`，覆盖 hosted-shell owner、first-run/return-run、Apps、Agent Chat、typed owner projection、first screen、failure projection 与 Apps Open targets。
- Menu bar 逐项映射：`D-MBAR-001..002` → `r062..r063`；`D-MBAR-003` → `r064,r100`；`D-MBAR-004..005` → `r065..r066`。菜单项、状态闭合集、freshness、event navigation 与 close/hide/quit 均已入权威。
- Error boundary 逐项映射：Desktop alias config 准入 → `r067`；`D-ERR-001..004`（含 `D-ERR-003a`）→ `r068..r072`；`D-ERR-005..006` → `r073..r074`；`D-ERR-007`/`D-ERR-007a` → `r075..r077,r101`；`D-ERR-008..012` → `r078..r082`。结构化 `NimiError`、Local Speech、SDK ReasonCode、bounded terminal projection、trace 与 recovery action 均已保留。
- Developer Tools 逐项映射：`D-DEV-001..007` → `r083..r089`，且 `D-SHELL-009` 的 in-app entry 由 `r010` 保留；gated surface、single Developer Mode、consent lifetime、native-risk disclosure 与 default-hidden boundary 均已入权威。
- Telemetry 逐项映射：`D-TEL-001..008` → `r090..r097`，覆盖 payload、message form、early logger injection、flow/invoke correlation、renderer forwarding、network severity 与 global trace propagation。
- 十三份旧表逐表映射：App Tabs → `r001,r083`；Build Chunks → `r005`；Log Areas → `r090,r096`；Error Codes → `r067..r072,r082`；Nimi Home Surfaces → `r049..r060`；Kit 三表 → `r040..r048`；renderer design 五表 → `r015..r032`。机器行已迁入 `config/desktop-shell-ui-*.yaml`，所有 config 均为非权威机器配置。
- 下文逐字保留七份旧契约散文，供历史 rationale 与逐条核对使用；现行 canonical 容器为 7 个 definition 加 101 个 rule，共 108 单元。

### 缺失

- 既有对账修复：旧 `D-DEV-001` 的“恰好 5 项”遗漏 Characters，`r001` 已用当前六项 ordinary primary navigation 闭合集修复；`D-ERR-008` 的空 operation mapping 由 `r078` 收口为 typed not-found 且禁止猜测；旧 renderer inventory 漏掉的 `profile.media.cards` 产品边界由 `r032` 保留。
- 既有表语义修复：Nimi Home、Kit 与 Error Codes 表内的 ownership、consumer 与 fail-closed 语义不能只随文件搬迁，已分别进入 `r040..r061` 与 `r067..r082`。
- 本轮逐句对账补齐 `D-SHELL-012` 被概括语吞掉的 Dashboard、Core Rules、Extended 内部模板与顺序，新增 `r098`。
- 本轮逐句对账补齐 `D-SHELL-013` 的 Power System 与 Realm Constellation source selection、截断、空态及 Core Rules placement，新增 `r099`。
- 本轮逐句对账补齐 `D-MBAR-003` 的 `running | degraded | starting | stopped | unavailable` 状态头闭合集，新增 `r100`。
- 本轮逐句对账补齐 `D-ERR-007` 对 Runtime Config、Local AI、usage、audit、dependency setup 读取的 bounded terminal projection，新增 `r101`。
- 本轮补齐数：4；补齐后缺失：0。

### 有意拒绝

- 过程性内容不入产品权威：`D-SHELL-015` 的 design-audit 协作措辞、`D-SHELL-019` 的迁移优先级、`D-SHELL-022` 的 gate-progress accounting，以及 `D-SHELL-027`、`D-SHELL-029`、`D-SHELL-030` 的 numbered rollout/cohort order 均保留为历史决策叙事；稳定 owner、surface hierarchy 与 fail-closed 边界已收录。
- 冲突或已被后续同簇决策取代的内容不入权威：旧 `D-DEV-001` 的五项 primary navigation 被当前六项闭合集取代；`D-SHELL-029` 的“profile hero 仅为 candidate / World Detail 是唯一 exception”中间态被后续 `D-SHELL-032` 的窄范围 profile hero controlled exception 取代。
- 已由相邻 owner 持有的值不在本容器重复：shell-mode feature defaults 由 `.nimi/spec/desktop/shell-runtime.authority.yaml` 持有；Runtime ReasonCode 默认消息与 retry projection 由 SDK 持有；Avatar renderer decommission 后的非-carrier presentation scope 由 `.nimi/spec/desktop/agent-projection.authority.yaml` 持有。本容器只保留 Desktop shell consumer stop-line。
- `D-ERR-006` 的“clear auth session”旧表达被拒绝；Desktop 只清理 redacted renderer account projection，不重新取得或修改 Runtime account custody。
- `D-ERR-007` 的固定中文句子、Phase 1/Phase 2 标签、未来 family 推荐文案与 reason-code PR checklist 不作为 canonical product authority；现行规则保留 wire reason、retry posture、关键 family distinction、explicit non-error finish state 与 fail-closed projection。
- `D-TEL-003` 的 `console.*` fallback 机制不作为产品权威；`r092` 只保留早期 logger injection、bridge forwarding 与 missing logger 必须可观测且不得成为产品成功证据。
- 旧表中的 module paths、CSS aliases、allowlist regex、test IDs、build chunk includes、surface rows与 descriptive copy 作为 non-authoritative machine configuration 保留，不提升为第二套 spec truth。
- Desktop-local Live2D/VRM renderer、app-local Agent Center config、direct Runtime/Realm/Cognition path、generic error success fallback、stale provider health、hidden Developer Mode、menu-bar stop/external-daemon selector均拒绝准入。

## Normative migration dispositions

- 设计与 Kit inventory 的 config 只供 gates、tests、generators 与 implementation audits 消费；canonical rules 决定 shared ownership、exception、theme、consumer 与 fail-closed semantics。
- `config/desktop-shell-ui-error-codes.yaml` 是 `r067` 指定的 Desktop bridge alias machine allowlist；它不替代 Runtime ReasonCode 或 SDK error projection authority。
- Historical `D-*` identifiers remain below only as rationale anchors and in non-authoritative config `source_rule` fields. Current stable normative identities are `rule.nimi.desktop.shell-ui.r001..r097`。

## Preserved source: UI Shell Contract

# UI Shell Contract

> Authority: Desktop Kernel

## Scope

Desktop UI Shell 契约。定义导航 Tab 体系、布局结构、路由映射、i18n 规范、主题约定、Vite 分包策略。

## D-SHELL-001 — 导航 Tab 体系

导航由 `navigation-config.tsx` 定义。普通用户 primary navigation 固定为：

```text
Home | Chat | Characters | Explore | Apps | Runtime
```

Tab 分组：

1. **Core Nav**（`getCoreNavItems()`）：home、chat、agents、explore、apps、runtime。
   `agents`（产品 label `Characters` / 「我的角色」）是本地 LocalAgent 列表
   surface：只投影 runtime `ListAgents` 权威（source-materialized、当前账号
   拥有的 ACTIVE agent），点击进入既有 `source-detail` dossier。它不得引入
   renderer-local 的并行 agent 真相。
2. **Secondary/System**：settings 等系统入口。它们可由菜单、账户区或设置入口打开，
   但不得作为普通 primary nav 项。
3. **Developer/Internal**：developer mode、diagnostics。这些 surface 不得作为
   Nimi Home 普通用户公开产品入口。
4. **Detail Tab**：profile、source-detail、world-detail、notification、
   gift-inbox、privacy-policy、terms-of-service。

`World` 必须折入 `Explore`；`AI Runtime` 的普通产品 label 必须为
`Runtime`。

Feature flag 门控：
- `enableRuntimeTab` 不得控制普通 Runtime primary nav 是否存在；Runtime 是
  baseline primary nav。该 flag 只能在实现迁移期作为 internal hardcut guard，
  不得进入产品 close evidence。

## D-SHELL-002 — Settings Panel Extension Areas

`MUST`：`enableSettingsExtensions` 只控制 host-owned Settings 面板中的
admitted first-party section composition。它不得被解释为第三方 product
extension channel、install surface、或 registry promise。

## D-SHELL-003 — 窗口管理

- `enableTitlebarDrag`：启用原生窗口拖拽（desktop only）。
- `start_window_drag` IPC 命令触发拖拽操作。
- Web 模式下所有窗口管理操作禁用。
- `enableMenuBarShell`：启用 macOS menu bar 顶栏入口（desktop macOS only）。关闭主窗口时的 hide-vs-quit 语义由 `D-MBAR-005` 定义。

## D-SHELL-004 — Vite 分包策略

代码分割策略：

- **同步加载**：shell-core、bridge（首屏必需）。
- **懒加载**：chat、explore、settings、profile，以及 Runtime Config 的 overview/cloud/local/runtime/catalog/profiles/recommend 子分包。

懒加载通过 `React.lazy(() => import(...))` 实现，配合 `Suspense` 边界。

## D-SHELL-005 — i18n 规范

- 翻译框架：`react-i18next`。
- 导航 label 使用 `t('Navigation.${id}', { defaultValue: item.label })`。
- locale 文件使用分片 bundle：`locales/en/*.json`、`locales/zh/*.json`。
- 缺失翻译 key 时，renderer 必须发出可观测 issue（例如通过 i18n issue listener / diagnostics surface），并返回人类可读 fallback 文案；不得因 missing key 直接抛错或触发 render crash。
- 缺失翻译属于内容完整性缺陷，不属于 renderer 可用性致命错误；Desktop 不得把 missing key 当作阻断 UI 渲染的 fail-close 条件。
- bundle 加载失败仍必须记录 error 级 issue，并允许受控回退到 `en` 资源，但单个 key 缺失不得升级成 app-unavailable 故障。

## D-SHELL-006 — 布局结构

`MainLayoutView` 定义两栏布局：

- **左侧 sidebar**：可折叠，包含 core nav + profile。
- **右侧 content**：根据 `activeTab` 渲染对应面板。

Content 面板映射：
- `chat` → `ChatPage`
- `explore` → `ExplorePanel`
- `apps` → `AppsPanel`
- `settings` → `SettingsPanel`
- `profile` → `ProfilePanel`（承载共享 profile detail surface）
- `gift-inbox` → `GiftInboxPanel`（礼物交易列表与详情入口，作为 full-page detail route）
- `runtime` → `RuntimeView`

## D-SHELL-007 — 图标系统

`renderShellNavIcon(icon)` 提供内联 SVG 图标：

- 支持的图标名：home、chat、explore、runtime、profile、settings、store、globe、wallet、agent/agents/my-agents/bot、terms/file/document、privacy/shield、logout
- `apps` 必须使用 app/grid/store 类熟悉图标，不得使用未知 fallback 作为
  close evidence。
- 未知图标名回退到 puzzle 图标。

## D-SHELL-008 — Shell Mode 检测

Shell 模式检测优先级（由高到低）：

1. `VITE_NIMI_SHELL_MODE` 环境变量（`'desktop'` / `'web'`）。
2. Tauri runtime presence 检测（`window.__TAURI_INTERNALS__` / `window.__TAURI_IPC__` 或等价 bridge 环境），不得要求 `window.__TAURI__` 全局暴露。
3. SSR 环境默认 `'desktop'`。

The closed result remains exactly `'desktop' | 'web'`. Simulator is not a shell
mode, is never detected by environment/global probing, and must not add a third
branch. The App-owned canonical renderer factory instead receives the opaque
`nimi.renderer.host/v1` binding defined by `P-KIT-042`/`P-SIM-006`.

检测结果驱动所有 feature flag 的默认值（`D-SHELL-001` ~ `D-SHELL-003`、`D-BOOT-004`）。

**统一 Feature Flag 派生表**（规范：`.nimi/spec/desktop/shell-runtime.authority.yaml` `rule.nimi.desktop.shell-runtime.r042`）：

| Flag | Desktop 默认 | Web 默认 | 控制规则 |
|---|---|---|---|
| `enableRuntimeTab` | `true` | `false` | `D-SHELL-001` |
| `enableSettingsExtensions` | `true` | `false` | `D-SHELL-002` |
| `enableTitlebarDrag` | `true` | `false` | `D-SHELL-003` |
| `enableMenuBarShell` | `true`（macOS）/ `false`（其他） | `false` | `D-MBAR-001` |
| `enableRuntimeBootstrap` | `true` | `false` | `D-BOOT-004` |

Web 模式下所有 runtime/window 相关功能默认禁用，仅保留基础 chat/social/explore 功能。此表为 `shellMode → flag` 映射的唯一定义，替代分散在各规则中的零散引用。

## D-SHELL-009 — Developer Mode Entry

Desktop 必须在 App 内提供显式的 Developer Mode 入口，而不是把开发模式建立在启动参数之上：

- Developer Mode 的开启、关闭与状态展示必须位于 App 内可发现位置（例如 Settings / Developer）。
- Developer Mode 负责管理 `dev` source directories、auto reload 开关与开发态诊断入口。
- 第三方开发者使用 Desktop 时，不应被要求通过启动参数或环境变量进入主要开发路径。

## D-SHELL-011 — World Detail Surface Order

Desktop `world-detail` surface 必须保持稳定的大区块顺序：

- `Hero`
- `Dashboard`
- `Core Rules`
- `Recommended`
- `Scenes`
- `Timeline`
- `Agents`
- `Extended`

视觉强化组件只能存在于这些 section 的内部，不得改变大区块顺序或把线性内容（如 timeline / agents）并入其它布局区。

- `Recommended` 负责承接规则理解后的首轮入口角色，不得与 `Agents` 全量角色区混用。
- `Scenes` 保持在 `Timeline` 之前，作为先地点、后事件的受控入口顺序。

## D-SHELL-012 — World Detail 分区式确定性布局

World Detail 使用 `分区式确定性布局（Section-Oriented Deterministic Layout）`。它的特点是：

- 页面级 section 顺序固定，不依赖自动补洞、瀑布流或 dense grid 改写视觉顺序。
- section 职责固定，只允许在 section 内部做受控自适应，不允许跨区漂移。
- 缺失数据时按预定义模板收缩，不保留空占位。
- 自适应范围只限于 section 内部的有限模板切换，属于 `受控自适应性`，不是自由拼装。

World Detail 在 section 内部允许使用固定模板卡片编排，但必须满足：

- 只能使用显式模板和固定 DOM 顺序，不得依赖 `grid-auto-flow: dense` 或其他会改变视觉顺序的自动补洞机制。
- 卡片缺失时必须通过预定义模板收缩，不得保留空占位。
- `Dashboard` 的主视觉行由评分矩阵与时间流速环组成，其余信息只能以下方文字信息卡进入确定性收缩模板。
- `Core Rules` 采用“规则速览 + 主体系卡 + 支撑规则卡”的受控分区结构：
  - 规则速览位于区块顶部，承担世界运转摘要。
  - 主体系视觉卡允许以固定 `6/6` 并排呈现。
  - 支撑规则卡（如禁忌、因果、语言）按内容存在情况进入受控收缩模板，不保留空位。
- `Extended` 采用“知识优先、运行治理后置”的固定结构：
  - `World Knowledge Highlights` 必须先于运行与治理信息出现。
  - 运行状态与治理轨迹允许使用固定 `5/7`、`6/6`、`8/4` 或单列模板，但不得改变“运行/治理在底部”的区块语义。

## D-SHELL-013 — World Detail Visual Card Mapping

World Detail 的视觉卡片必须只消费现有 world detail 数据 contract：

- `Dashboard` 不引入独立事件视觉卡；事件统计必须保留在线性 `Timeline` section 的文字/筛选语义内。
- `Power System` 卡优先消费 `semantic.powerSystems[0]`，为空时 fallback 到 `semantic.standaloneLevels`；无 levels 时不渲染；levels 超过 `12` 时截断；其他 power systems 只能以 compact 文本显示。
- `Realm Constellation`：来自 `semantic.topology`；realm 超过 `8` 时截断；无 realm 且无 topology 元信息时不渲染；仅有 topology 元信息时渲染 meta pills 与空态。
- `世界如何运转` 规则卡只消费 ordered `rule items`，并只显示 `title + value`；`key` 仅作为程序稳定标识，不直接作为 detail 主显示字段。
- `维护轨迹` 默认主显示字段固定为 `title / summary / createdAt`；`mutationType / targetPath / reason` 只允许留在维护面、调试面或技术视角里，不得作为 world detail 主视觉内容。
- 上述卡片只能作为 `Core Rules` 的卡片内容，不得形成新的页面级布局体系。

## D-SHELL-014 — World Detail Motion & Testability

World Detail 的视觉卡与 section surface 必须满足：

- 持续动画必须支持 `prefers-reduced-motion: reduce` 并降级为静态或弱动效。
- 视觉卡 hover 信息必须通过可测试的 tooltip / overlay surface 呈现，不得只依赖 CSS `title`。
- section root、关键视觉卡和可见的 layout surface 必须暴露稳定 `data-testid`。
- World Detail 的实现、spec 和测试必须共同验证 live surface 仍然通过 `world-detail.tsx -> world-detail-template.tsx` 渲染。

## D-SHELL-015 — Renderer Design Baseline

Desktop renderer 的共享 UI 设计必须通过 renderer-level semantic token 与 primitive facade 收敛，而不是继续把重复 UI 常量分散在 feature-local 组件内。

- baseline surface 的默认落点是 renderer `styles.css`、kit UI primitives、以及当前受治理的 renderer shared components；不得恢复旧的 standalone action/surface/overlay component truth。
- 受治理的 secondary consumer 必须在 `tables/renderer-design-surfaces.yaml` 中显式登记；`secondary consumer` 不能只存在于 domain prose 或 code review 记忆里。
- feature-local primitive 不得继续作为 `chat`、`runtime-config`、`settings` sidebar family 的事实源；内部左侧栏必须通过共享 sidebar primitive 与对应 fact table 治理。
- design audit、spec、check 与 renderer implementation 必须围绕同一组 baseline primitive 演进。

## D-SHELL-016 — Token Resolution

Desktop baseline surface 的共享设计值必须通过命名 token 解析：

- brand、surface、text、radius、elevation、z-index、motion、typography、spacing、stroke 与 state 的 baseline 值必须登记在 `tables/renderer-design-tokens.yaml`。
- baseline surface 不得直接硬编码 raw brand hex、隐式 shared surface 色值或重复 elevation 常量，除非被 `renderer-design-allowlists.yaml` 明确豁免。
- shared primitive 负责把 token 投影为 CSS variable / utility / facade API；feature 代码不得绕过该映射层直接复制 token 值。

## D-SHELL-017 — Surface Taxonomy

Desktop baseline surface 的共享角色固定为：

- `canvas`：页面底布、scroll root、空态背景。
- `panel`：sidebar、section shell、active list bucket。
- `card`：list row、content card、inline data container。
- `hero`：顶部重点视觉容器，但仍属于 baseline taxonomy。
- `overlay`：dialog / drawer / popover / tooltip 的 panel tone。

这些角色与具体模块的映射必须登记在 `tables/renderer-design-surfaces.yaml`；baseline、secondary、exception 不得混写在实现习惯里。

对 `sidebar` 的具体视觉与交互约束由 `D-SHELL-023` ~ `D-SHELL-025` 单独定义；`panel` 角色本身不再允许隐式承载多套 sidebar family。

## D-SHELL-018 — Overlay Taxonomy

Desktop baseline overlay 只能使用以下共享 kind：

- `dialog`
- `drawer`
- `popover`
- `tooltip`

overlay 的 module、surface tone、elevation、z token、testability 与 reduced-motion 策略必须登记在 `tables/renderer-design-overlays.yaml`。凡是被 design governance 覆盖的 overlay consumer，不得继续停留在“实现存在但表未登记”的状态；baseline surface 不得继续定义未经登记的本地 overlay shell。

## D-SHELL-019 — Main Surface Baseline

`chat`、`explore` 是 desktop 主设计语言的 baseline anchors：

- 这些 surface 必须优先消费共享 `surface / action / overlay` primitive。
- baseline 迁移优先级以 root shell、list/card、primary/secondary/icon actions、tooltip 与一个标准 dialog family 为先。
- 新增 baseline 视觉决策必须先在这些 surface 验证，再扩散到 secondary/admin surface。

The canonical renderer factory exposes these same current surfaces and their
same style closure to Desktop production hosts and Simulator. Simulator cannot
substitute a simplified page, App-specific wrapper UI, alternate copy, or
forked CSS implementation. Host bindings may change data and supported
operations, but never the selected component tree or design-language source.

## D-SHELL-020 — Controlled Exceptions

`world-detail` 是 desktop renderer 的受控 art-directed exception：

- exception surface 必须在 `tables/renderer-design-surfaces.yaml` 中显式登记，不能只靠实现约定。
- exception 可以使用独立 palette、radius、motion 与视觉编排，但不得把 exception token 或 overlay shell 泄漏到 baseline surface。
- `world-detail` 的例外治理继续受 `D-SHELL-011` ~ `D-SHELL-014` 约束，不得借 design pilot 稀释原有 contract。

## D-SHELL-021 — Arbitrary Value Policy

baseline surface 的 arbitrary Tailwind value 与 inline style 默认禁止：

- `rounded-[...]`、`z-[...]` 与 <span v-pre>`style={{...}}`</span> 只有在 `tables/renderer-design-allowlists.yaml` 中登记后才允许保留。
- allowlist 必须带 `scope`、`reason` 与 `source_rule`，用于描述动态几何、受控动画或 renderer bridge 需要的例外。
- allowlist 是过渡治理工具，不等于永久自由区；新增例外必须说明为什么不能落入共享 token / primitive。

## D-SHELL-022 — Primitive Adoption Boundary

baseline surface 的共享 action、surface、dialog、popover 与 tooltip 必须经过 renderer-level primitive facade：

- `chat`、`explore` 中新增或重写的 baseline button / card / dialog / tooltip 不得再定义本地 shell。
- 受治理的 overlay adoption 以 table registration 为准；凡是在 `renderer-design-overlays.yaml` 中登记的 module，必须通过 shared overlay primitive 暴露 dialog / drawer / popover / tooltip shell。
- 允许 feature 组合 shared primitive，但不允许重新发明另一套 baseline shell class contract。
- adoption 进度由 `D-GATE-091` 追踪；完成前允许局部 legacy 实现存在，但不得继续扩散。

## D-SHELL-023 — Sidebar Family Contract

`runtime-config`、`settings` 的 feature 内部左侧栏必须属于同一个 desktop sidebar family。

- 统一 family 固定为 `desktop-sidebar-v1`，事实源为 `tables/renderer-design-sidebars.yaml`。
- 允许的信息架构变体仅限：
  - `runtime-config`：`header + sectioned nav-row list`
  - `settings`：`header + sectioned nav-row list`
- family 必须通过共享 sidebar primitive 暴露一致的 slot：
  - `container`
  - `header`
  - `sectionLabel*`
  - `itemList+`
  - `resizeHandle?`
- `chat` surface 的最外层 contact rail 属于主 shell 级 target rail 组合，不属于本规则范围；该 rail 可以作为 app-owned composition 存在，但不得反向声明自己是 `desktop-sidebar-v1`。

## D-SHELL-024 — Sidebar Item Taxonomy

desktop sidebar family 的 item 语义固定为：

- `entity-row`：头像/实体型列表项，适用于 contact-like record。
- `category-row`：分类或聚合入口。
- `nav-row`：设置/运行时页面导航项。

item trailing affordance 只允许：

- `badge`
- `status-dot`
- `chevron`
- `count`

这些 item kind 与 affordance 的使用必须和 `tables/renderer-design-sidebars.yaml` 中的声明一致，不得在实现中继续发明第四套 row contract。

## D-SHELL-025 — Sidebar Visual Contract

desktop sidebar family 的视觉与交互 contract 固定为共享 token + primitive：

- sidebar 背景、边界、header 高度、horizontal padding、item 高度、item hover/active、section label typography、search shell 与 resize handle 命中区必须使用共享 sidebar token。
- `runtime-config` 与 `settings` 不再允许维持独立的 sidebar 样式系统；本地 `SidebarNav` / `RuntimeSidebar` / 等价 helper 若继续承载样式 contract，视为违约。
- resizable sidebar 的动态宽度必须通过共享 `SidebarShell` / `SidebarResizeHandle` 处理；feature 代码不得用独立的 sidebar inline style 重新定义视觉 contract。
- active row、section label 与 trailing affordance 必须在治理内 sidebar 上保持同一家族的一致语义与交互反馈。

## D-SHELL-026 — Desktop Material Baseline Adoption

Desktop renderer 在采用平台 material / ambient 语言时，必须把该语言视为
Desktop shell baseline 的视觉表达，而不是每个 route 独立发明的一次性皮肤。

- Desktop 对 platform `P-DESIGN-022` / `P-DESIGN-023` 的消费只允许通过
  admitted kit surface（如 `AmbientBackground`、`Surface material=*`）或与其
  等价的 token-backed shared primitive facade 完成。
- Desktop baseline shell 不得创建独立的 app-local material registry、
  ambient gradient registry、或第二套 shell visual contract 来“解释”同一组
  material token。
- Desktop shell visual baseline 继续服从 `D-SHELL-015` ~ `D-SHELL-025`
  的 taxonomy；material 是这些 baseline surface 的表达轴之一，不是新的
  route ownership 或 layout ownership。
- `nimi-accent` 继续承担 shared Nimi mint identity；accent 不得焊死进
  material/background truth。

## D-SHELL-027 — Shell Ambient Ownership And Rollout Order

Desktop ambient 的 canonical owner 固定为 shell frame，而不是 baseline /
secondary route 各自重复的局部背景实现。

- Ambient 默认属于 Desktop shell root、main layout host、以及后续 admitted
  shell-level chrome surface；baseline / secondary route 不得各自复制整页
  ambient mesh，除非后续 preflight 把它作为受控例外显式准入。
- shell ambient 的首选语义是“一个应用壳里的连续空间”，而不是“每个页面一张
  独立海报”。route content 应被视为浮在 shell ambient 之上的受控 surface。
- redesign rollout order 固定如下：
  1. shell frame / navigation chrome
  2. baseline route cohort: `home`, `explore`, `notification`,
     `profile`
  3. dense operational cohort: `settings`, `runtime-config`, equivalent admin /
     operations surfaces
  4. chat / agent surfaces only after a separate admitted decision packet
- 在上述顺序被新的 admitted authority 明确改写前，任何实现都不得跳过 shell frame
  直接重做 chat、runtime-config、或其他更高耦合 surface。

## D-SHELL-028 — Dense Surface Downgrade And Exception Preservation

Desktop 的 material adoption 必须承认操作密度差异：不是所有 surface 都应该
默认玻璃化。

- `settings`、`runtime-config`、local-model center、audit / diagnostics /
  inspector-like panels，以及其他以扫描效率、数据密度、可读性为首要目标的
  operational surface，默认采用 `solid`-first policy。
- 这些 dense operational surfaces 只有在后续 admitted packet 明确证明局部
  glass 使用不会损害 contrast、scan speed、reduced-transparency behavior 或
  performance 时，才允许引入窄范围 `glass-regular` / `glass-thick`。
- `chat` 与 `agent` surface 不因本规则自动获得 glass admission；它们属于单独
  decision surface，必须在后续 authority update 里显式决定。
- `world-detail` 继续是 `D-SHELL-020` 所定义的 controlled exception。
  Desktop shell redesign 不得把它降格为 baseline pilot，也不得把它的
  exception-specific art direction 反向扩散到 baseline shell。

## D-SHELL-029 — Secondary Card Hierarchy And Cohort Freeze

当 Desktop route root 已经落在 admitted shell glass host 上时，route-local
secondary / tertiary card 不得继续按 feature 自发发明新的 material 家族。

- route-local card hierarchy 只允许以下四类受控归属：
  1. `promoted glass card`：适用于 `home`、`explore`、`notification`、
     `profile` 等非高密度 route 的 promoted summary / discovery / hero-adjacent
     card；它必须消费 admitted kit material 与 Desktop token-backed facade，
     不得自定义另一套 blur、glass tint、border recipe。
  2. `operational solid card`：适用于 `settings`、`runtime-config`、
     local-model center、audit / diagnostics / inspector-like panel，以及其他以
     scan speed、contrast、密度可读性为先的运营型 card；该类 surface 继续服从
     `D-SHELL-028` 的 `solid-first` 默认。
  3. `overlay / dialog surface`：route-local dialog / drawer / popover /
     tooltip 继续只受 `D-SHELL-018` 治理；overlay 不是绕开 secondary card
     hierarchy 的新入口。
  4. `controlled art-directed exception`：只有在
     `tables/renderer-design-surfaces.yaml` 中被显式登记为 exception 的 surface
     才允许保留独立 hero-glass / branded-glass / bespoke geometry 语言。
- `chat` / `agent` surface 仍然不是自动 admitted exception，也不因 shell glass
  baseline 落地而自动获得自由 glass 权限；它们必须作为单独收敛 cohort 接入共享
  hierarchy，而不是把当前 local recipe 升格为事实标准。
- Desktop-local Live2D / VRM renderer chrome 已退役；`chat` surface 不得以
  avatar/stage viewport 名义恢复 Cubism、Three.js、debug-control UI 或 renderer-local
  presentation recipe。
- profile detail 的 branded hero-glass 族谱在单独 decision packet 闭环前，
  只允许作为 `secondary` surface 注册为 exception candidate，不得直接提升成
  admitted exception。
- `world-detail` 继续是当前唯一受控的 Desktop art-directed exception；任何其他
  route-local card 只有在后续 admitted authority 明确授权时，才允许升级为 exception。
- route-local secondary / tertiary card cluster 必须在
  `tables/renderer-design-surfaces.yaml` 中显式登记；只登记 route root 不足以表达
  inner-card hierarchy。
- 本轮 authority cut 冻结的实现 cohort 顺序固定如下：
  1. `chat` secondary card cluster + shared `settings` / `runtime-config`
     operational card wrapper
  2. `home` / `explore` / `notification` inner-card convergence
  3. profile detail branded card decision packet
- 在上述 cohort 被新的 admitted authority 改写前，Desktop 不得把 leaf card restyle
  伪装成局部清理并跳过共享 hierarchy 收敛。

## D-SHELL-030 — Chat Secondary Surface Boundary And Exception Freeze

`chat` 在 Desktop 内仍然是单独 decision surface，但这不等于它可以继续把当前的
 feature-local emerald / white-card / arbitrary-radius recipe 当成事实标准。

- 以下 `chat` surface family 必须被视为 shared-path converging cohort，而不是
  `chat`-owned art direction：
  1. `chat-page` 内部仍然视觉上表现为 shared utility control 的 floating/folded
     controls；它们继续受 baseline/shared token discipline 约束，不得以
     `emerald-*` bypass 重新定义 Desktop button family。
  2. 右栏 utility/settings rail controls（如 thinking / settings / fold /
     hands-free toggles）属于 shared action family 候选；它们不得继续以
     feature-local rail button recipe 形成平行 button registry。
  3. session/history/summary cards 与 target selector 等 shared-looking
     secondary cards 必须接入 admitted Desktop shared surface/action path，
     不能继续维护 `chat`-only white-card family。
  4. diagnostics / inspector / runtime inspect panels 继续属于 operational
     surface；它们默认服从 `solid-first`，但必须通过 shared operational card
     path 收敛，而不是继续维护 `chat`-local inspection card formula。
- 以下 `chat` surface family 在新的 admitted packet 明确改写前，只能作为
  `chat`-owned convergence candidate 登记，不得被默认为 shared card：
  1. canonical transcript / stage conversation chrome
  2. Avatar app handoff / status chrome（不包含 Desktop-local Live2D / VRM renderer）
  3. 与 avatar presentation 强绑定的 presence / status chrome
- `chat` exception candidate 不是自动 admitted exception。只有在
  `tables/renderer-design-surfaces.yaml` 中被显式登记并在后续 authority update 中明确保留时，
  才允许继续使用 bespoke geometry、gradient、orbital chrome 或 renderer-local
  presentation recipe。
- `chat` secondary / tertiary surface cluster 必须在
  `tables/renderer-design-surfaces.yaml` 中显式登记为 converging cohort 或
  governed surface；只登记 `chat.page.root`
  不足以表达当前边界。
- 本轮 authority cut 冻结的实现顺序固定如下：
  1. `chat-page` floating controls + right-panel utility/settings rail controls
  2. session/history/target-selector/inspect/diagnostics cards
  3. canonical conversation chrome + avatar/stage viewport chrome 的单独
     exception decision packet
- 在上述边界被新的 admitted authority 改写前，Desktop 不得把 `chat` 的 leaf restyle
  伪装成“只是微调颜色”来跳过 shared-path 或 exception-candidate decision。

## D-SHELL-031 — Chat Canonical Ownership And Avatar Viewport Exception Admission

`chat` 的 W3 decision packet 必须把 W1 冻结的 exception candidate 明确分流，不能让
candidate 状态永久停留在 Desktop authority 里。

- `chat-human-canonical-components.tsx` 不拥有 canonical transcript / stage
  chrome。Desktop 在该文件里只允许：
  1. 为 `CanonicalTranscriptView` / `CanonicalStagePanel` 适配数据、message
     renderers、drawer content、sidebar content 和 diagnostics summary
  2. 在不改写 canonical shell ownership 的前提下，定义与 message content、
     accessory slot、voice inspect flow 强绑定的局部交互内容
- Desktop 不得因为 `chat-human-canonical-components.tsx` 仍包含本地 accessory /
  content renderer，就把整份 canonical shell 重新归类成 `chat`-owned
  art-directed exception。
- 先前的 `chat` avatar viewport chrome（Live2D / VRM）controlled exception 已随
  desktop-local avatar carrier decommission 退役；desktop 不再把本地 avatar viewport/render chrome
  作为当前 shell exception line。
- Decommission 之后，desktop 在该 area 只保留：
  1. avatar-app launcher / handoff affordance chrome
  2. 非-carrier backdrop / shell atmosphere chrome
  3. 与 canonical transcript shell 共存但不重开本地 carrier 的辅助说明文案
- `chat-human-canonical-components.tsx` 内剩余的 accessory / overlay / content
  renderer 漂移，不因本规则自动获得 exception admission；如果后续要收敛，必须在
  canonical-shell 或 kit-owned chat surface 线里单独 admitted。
- `tables/renderer-design-surfaces.yaml` 必须把本轮 disposition 显式记录为：
  1. `chat.canonical.conversation_shell_adapter`
  2. retired desktop avatar viewport exceptions remain history only and do not
     constitute current shell authority

## D-SHELL-032 — Shared Profile Detail Hero Exception Freeze

shared profile detail / profile 不再允许被当成一整块 branded subsystem。W1 decision packet
必须把 page shell-root、hero shell、feed cards 三类 surface 拆开治理。Desktop
不拥有 standalone relationship primary page；本规则只治理仍被 Home、Explore、Chat、Profile
复用的 profile detail modal/content。

- `profile.panel.root` 继续是 Desktop shared shell root
  consumer，不得因为 detail hero shell 仍然品牌化，就整体回退成
  profile-owned art direction。
- shared profile detail hero shell 现被限定为一组窄范围 controlled exception，
  仅覆盖：
  1. detail hero header / backdrop aura
  2. detail hero glass slab 与 companion skeleton / loading / error shell
  3. 与 detail hero shell 强绑定的 branded stats/action chrome
- 上述 hero exception 不自动扩展到：
  1. `profile` feed cards
  2. generic overlay / dialog surfaces
  3. sidebar rows、category rows、search rows
- `profile` tab content cards（posts / likes / collections / media / gifts）与
  other profile-adjacent cards 必须被视为 converging cohort，而不是 hero
  exception 的自然延伸。它们后续只能通过 admitted Desktop shared card/action
  path 收敛，不得继续维持 branded white-card / mint-accent local family。
- profile detail branded mint accent、arbitrary radius、white-card shadow
  formula，不得再被表述成“profile 特例”。只有在
  `renderer-design-surfaces.yaml` 中被显式登记为 exception 的 detail hero shell
  才允许保留 bespoke geometry 与 glass aura。
- `tables/renderer-design-surfaces.yaml` 必须把本轮 disposition 显式记录为：
  1. `relationship.profile_detail.hero_exception`
  2. `relationship.profile_detail.shell_exception`
  3. `profile.posts.cards`
  4. `profile.likes.cards`
  5. `profile.collections.cards`
  6. `profile.media.cards`
  7. `profile.gifts.cards`

## D-SHELL-033 — App-Level Attention Context Boundary

Desktop UI shell may own an app-level transient `AttentionContext` for the
active desktop viewport.

The admitted shell-level attention signal set is limited to:

- viewport-scoped active / inactive presence
- continuous presence strength for entry / exit degrade
- normalized app-viewport `x / y` coordinates

Fixed rules:

- UI shell owns desktop window / app viewport attention intake; feature-local
  surfaces must not each become independent DOM pointer owners for the same
  canonical app-level attention line
- app-level attention remains desktop-shell-local transient truth; it must not
  become runtime truth, cross-thread persistence truth, or generic chat
  behavior truth
- shell-owned attention is an upstream input for surface-specific consumers
  such as avatar projection; shell does not thereby become owner of those
  product semantics
- loss of viewport validity, blur, or shell teardown must deterministically
  clear or degrade active attention state
- app-level attention admission does not authorize generic click semantics,
  drag semantics, orbit camera behavior, or arbitrary expansion into unrelated
  feature-local interaction contracts
- when a downstream surface requires a narrower semantic projection, that
  projection must be defined in the consuming surface authority instead of
  backfilling a second shell-local or feature-local raw attention owner

## D-SHELL-034 — Desktop Agent Chat Occupancy Rectangle Authority

For the admitted desktop obstacle-aware transcript-flow line, `UI Shell` is the
sole canonical owner of the occupancy rectangle consumed by transcript reflow.

The admitted rectangle fields are:

- `x`
- `y`
- `width`
- `height`
- `wrap_policy`

Fixed rules:

- the rectangle is transcript geometry truth, not avatar interaction truth,
  renderer-local footprint truth, or runtime presentation truth
- only one shell-owned right-dock occupancy rectangle is admitted in the first
  desktop line
- `UI Shell` owns transcript geometry, transcript viewport coordinates, scroll
  root, composer clearance, occupancy clamping, final rectangle derivation, and
  reflow trigger policy
- `Agent Avatar Surface` may expose only non-canonical advisory inputs such as
  `preferred_anchor` or `preferred_footprint_hint`; it must not own admitted
  occupancy rectangle truth
- `kit/features/chat` may consume shell-owned occupancy geometry only; it must
  not derive admitted rectangle truth from avatar viewport state or slot output
- runtime remains a non-owner of occupancy rectangle truth, transcript
  geometry, and shell-local scene/layout state

## D-SHELL-035 — Desktop Agent Chat Obstacle-Flow Taxonomy

For the admitted desktop obstacle-aware transcript-flow line, only an explicit
shell-owned flowing whitelist may participate in obstacle-aware transcript
reflow.

Admitted flowing blocks:

- `paragraph text`
- `heading text`
- `list item text`
- `quote text`

These blocks may flow only when their inline children remain pure-text inline
content.

Fixed blocks:

- `code fence`
- `inline code`
- `table`
- `image block`
- `video block`
- `audio block`
- `attachment block`
- `inline image`
- `HTML block`
- `math block`
- `custom embedded component`
- `mixed-media block`
- transcript shell chrome such as streaming / typing bubble, date separator,
  loading / error / empty state / banner / history intro, and pending media
  placeholder blocks

Fixed rules:

- any unknown, unclassified, or newly introduced block kind must fail closed to
  `fixed`
- parser, renderer, slot output, or engine capability must not silently widen
  the flowing whitelist
- `UI Shell` owns the admitted flowing/fixed classification used for obstacle
  flow
- `kit/features/chat` and desktop adapters must consume this taxonomy and must
  not reclassify block kinds locally

## D-SHELL-036 — Desktop Agent Chat Transcript Stability Invariants

For the admitted desktop obstacle-aware transcript-flow line, transcript
stability invariants are shell-owned canonical truth.

Fixed invariants:

- transcript history has exactly one canonical scroll root
- composer clearance is shell-owned admitted geometry truth
- occupancy change may trigger reflow only on discrete shell-admitted state
  transitions
- per-frame movement, animation ticks, transform sampling, physics motion, or
  pointer-driven updates must not trigger transcript reflow
- admitted occupancy must remain frozen while transcript streaming or
  pending-first-beat growth is active
- near-bottom detection and bottom-follow behavior remain shell-owned

Fixed rules:

- renderer, adapter, slot, or DOM-measurement logic may support implementation,
  but they must not become canonical owners of scroll anchoring, composer
  clearance, reflow timing, transcript root ownership, or bottom-follow
  behavior
- desktop-local obstacle-aware behavior must not fork grouping,
  virtualization, or transcript scroll truth away from the canonical shell path

## D-SHELL-037 — Desktop Chat Obstacle-Flow Kit Exception Consumer Boundary

For the admitted desktop obstacle-aware transcript-flow line,
`kit/features/chat` remains a desktop-controlled exception consumer rather than
reopened shared canonical shell ownership.

Fixed rules:

- desktop `UI Shell` owns the occupancy-aware shell truth for this admitted
  desktop line
- `kit/features/chat` remains the shared parity owner outside that line
- `kit/features/chat` may consume desktop-injected occupancy geometry or
  taxonomy only through the canonical adapter surface; it must not become a
  shadow transcript shell owner
- `chat-human-canonical-components.tsx` remains an adapter surface and must not
  bypass `CanonicalTranscriptView`, fork grouping/virtualization/scroll-root
  truth, or rebuild a second bubble container through slot APIs
- `tables/renderer-design-surfaces.yaml` must keep
  `chat.canonical.conversation_shell_adapter` as the registered adapter surface
  for this posture
- any future widening into shared non-desktop shell truth requires an explicit
  separate authority reopen

## D-SHELL-038 - Local App Launch Host

`tables/local-app-launch-hosts.yaml` records the final host-neutral local-app
launch behavior despite its retained authority-file path. Desktop may launch an
isolated `local_development` Electron or Tauri child only after the Runtime-owned
record and Desktop decision path succeed. The native supervisor obtains a
single-use launch lease, starts the exact controlled output, binds the live
process, and attaches the request-empty local-app session carrier without
exposing any material to the renderer.

Shipped Zhiyu/Avatar remain bundled and are excluded from third-party local-app
records. The Zhiyu integration build used by acceptance is a distinct isolated
`local_development` project and principal. Immutable verified/user-imported
package launch remains typed unavailable until 0P/P and cannot fall back to
`OpenApp`, local adoption, account inventory, tester registration, Desktop
identity, process liveness, renderer metadata or ordinary gRPC.

Every process replacement and Runtime restart requires a new lease, bind and
session. Desktop exposes only Kit typed session status, public permission
status/request, base entitlements and exact app-owned commands; it injects no
account/token/principal/permission-decision/endpoint material. Internal
operation ids and resource refs never enter the renderer or approval UI.

## D-SHELL-039 - Desktop Open Intent Navigation Targets

Desktop UI Shell owns the renderer-side application of admitted Desktop Open
Intent navigation targets. Platform `P-DOPEN-*` may reference Desktop target
catalogs, but it must not duplicate Desktop IA values or mutate Desktop shell
state.

Desktop-owned target catalogs:

- `tables/desktop-open-targets.yaml` is the aggregate Desktop Open target
  catalog.
- `tables/runtime-config-open-actions.yaml` owns Runtime Config
  `cloud.add-connector` and `models.install-model` action focus targets.
- `tables/settings-open-targets.yaml` owns the admitted Settings `profile`
  target.
- `tables/agents-open-targets.yaml` owns the admitted Agents `inventory`
  target.

Renderer navigation must apply target mappings through Desktop-owned store or
controller APIs. A tab switch alone is not sufficient evidence for targets that
require page-owned focus state.

## Fact Sources

- `tables/app-tabs.yaml` — 导航 Tab 枚举
- `tables/local-app-launch-hosts.yaml` - local-app launch host behavior
  registry
- `tables/desktop-open-targets.yaml` - aggregate Desktop Open target catalog
- `tables/runtime-config-open-actions.yaml` - Runtime Config Desktop Open action targets
- `tables/settings-open-targets.yaml` - Settings Desktop Open targets
- `tables/agents-open-targets.yaml` - Agents Desktop Open targets
- `.nimi/spec/desktop/shell-runtime.authority.yaml` — Feature flag 规范
- `tables/build-chunks.yaml` — Vite 分包枚举
- `tables/renderer-design-tokens.yaml` — baseline semantic design token
- `tables/renderer-design-surfaces.yaml` — baseline / secondary / exception surface mapping
- `tables/renderer-design-sidebars.yaml` — governed desktop sidebar family mapping
- `tables/renderer-design-overlays.yaml` — shared overlay taxonomy
- `tables/renderer-design-allowlists.yaml` — arbitrary value / inline style allowlists
- `menu-bar-shell-contract.md` — macOS menu bar shell 入口
- `.nimi/spec/desktop/agent-projection.authority.yaml` — avatar projection consume boundary for shell-owned attention

## Preserved source: Nimi Home Shell Contract

# Nimi Home Shell Contract

> Owner Domain: `D-HOME-*`

## Scope

定义 desktop host 渲染 `Nimi Home`（Platform `P-HOME-*`）的 hosted shell IA、
first-run state machine、return-run state machine、surface registry 投影、
Agent Chat in-shell 引用 placement、`AIScopeRef` 强制规则、与 no-private-path
强制规则。

本契约只拥有 desktop-hosted shell 实现层；Platform `P-HOME-*` 拥有产品
ontology 与 non-owner 边界。两者必须在每条规则上互相不重叠。

## D-HOME-001 — Hosted Shell Ownership

`MUST`：desktop host 拥有 `Nimi Home` hosted shell IA、navigation、surface
placement、windowing、与 first-run / return-run state machine 的实现。

`MUST NOT`：desktop host 不得在 hosted shell 之上自定义产品 ontology；
ontology 由 Platform `P-HOME-001..P-HOME-010` 拥有。

## D-HOME-002 — First-Run State Machine

`MUST`：first-run state machine 必须消费 `P-AIPS-010` 的 factory
AIProfile 状态（`ai-profile-pending` / `ai-profile-accepted` /
`ai-profile-materializing` / `ai-profile-active` / `ai-profile-failed`）
以及 `P-COLD-*` 的 fail-closed cold-start 状态。

`MUST NOT`：first-run 不得在 `active` evidence 缺失时投影 `ready`、
`available`、或 generic `done`；不得直接跳过 alias 接受步骤；不得在
Runtime materializer confirmation 之前启动本地 dependency download /
install / repair。

## D-HOME-003 — Return-Run State Machine

`MUST`：return-run state machine 在没有重新触发 first-run 的情况下，仍
必须显式处理 Runtime health、account state、app status、settings、与
developer-mode toggles 的状态变迁。

`MUST NOT`：return-run 不得跳过 cold-start fail-closed 投影；任何 upstream
authority 缺失仍按 `P-COLD-001` 状态投影。

## D-HOME-004 — Apps Surface Placement

`MUST`：Apps surface placement 是 Desktop primary navigation 的 ordinary
入口之一。Apps 行的数据 source 由 SDK `NimiAppClient.list()` 的 unified
inventory projection 提供；该 projection 保留 Platform catalog、Runtime
authenticated account inventory、Runtime local-record 三个 source。
Desktop 只负责呈现 source/state/action，不拥有 source truth。

`MUST NOT`：Apps 不得拥有 app admission truth、marketplace truth、或
package trust truth；不得读取 app-local spec、workspace source tree、package
manager install roots、或未 admitted registry row 作为 catalog 可见性来源；
不得把 local record 投影为 ordinary catalog admission；不得显示 Avatar。

## D-HOME-005 — Apps Card State Placement

`MUST`：Apps 必须以显式 typed projection 区分 catalog-only、account-visible、
local-record-active/dormant/removed、permission-required、unsupported、
blocked-by-policy 与 immutable-package-unavailable。0K 不得显示 immutable
install/update/repair 正向成功；这些状态只有 0P/P admission 后才可加入。

`MUST NOT`：Apps 不得自创 app registry truth；不得把 distinct
fail-closed 状态压缩为单一 `Unavailable` / `Blocked`；admission state 由
Nimi App registry 拥有，package readiness 由 package/runtime projection
拥有。

`MUST NOT`：Apps 不提供 workspace connect/adoption 入口。Mutable project
admission 只在 Developer Mode/Developer Tools 通过 `D-DEV-*` 与 `D-IPC-019`
进入；Desktop 不得扫描本地 app、不得写 local record truth、不得从
renderer-local in-flight state 推断接入成功。

`MUST`：Apps 只能把 `capabilitySet` 投影为 App 声明使用的 Nimi 平台功能，不得据此推导用户权限、账户授权、启动前 prompt 或 grant。Permissions 只能来自 SDK 明确公开的 permission requirement/posture projection；当 unified inventory 没有该字段时，Apps 卡片和详情不得显示 permission requirement。

## D-HOME-006 — Agent Chat Placement

`MUST`：Agent Chat 是 Home 内 in-shell reference surface（`P-HOME-006`）。
其在 shell 中的 placement、入口、与 UI navigation 由本契约拥有。

`MUST NOT`：Agent Chat surface 不得在 hosted shell 层拥有
transcript / history / identity / grant / memory / `ConversationAnchor`
truth。这些 ownership 由 permission fabric、RuntimeAgentService、Realm、
and Cognition 接管。

## D-HOME-007 — AIScopeRef Enforcement

`MUST`：Agent Chat 执行 path（包括任何调用 Runtime AI execution 的
shell-internal flow）必须显式携带 `AIScopeRef`（`P-AISC-001`、
`S-AICONF-003`）。

mechanical guard：`check:home-shell-aiscoperef-required`。

## D-HOME-008 — No Private Runtime Path

`MUST NOT`：hosted shell 任何代码层不得 import：

- `runtime/internal/**`
- Realm private client / private transport
- SDK private internals

mechanical guard：`check:home-shell-no-runtime-internal-import`，
required before hosted-shell release claim。

## D-HOME-009 — Runtime / Account / Diagnostics Surface Consumption

`MUST`：Runtime health、app health、account、settings、diagnostics、
developer-mode 等 surface 必须通过 SDK typed path 消费 Runtime / Realm /
Cognition projection。

`MUST NOT`：不得在 renderer 层直接 fetch Runtime gRPC、Realm REST、或
Cognition raw artifact；不得绕过 SDK 的 typed projection 形成 shell-local
authority。

## D-HOME-010 — Self-Update UI Projection

`MUST`：self-update UI 消费 `P-SUPD-002` 与 `P-PKGREL-006` 的 fail-closed
投影；UI 文案可重命名状态，但必须保留 typed distinction（`failed`、
`rollback-required`、`verification-failed`、`unsupported`、
`stale-projection`）。

`MUST NOT`：self-update UI 不得 mutate Runtime-owned selected source
record 或 local environment dependency state（`P-SUPD-005`）。

## D-HOME-011 — First Screen Rule

`MUST`：Home 首屏必须落在 Platform `P-HOME-010` 定义的 usable product
control。允许首屏直接展示 cold-start fail-closed 状态（含 setup-required、
needs-confirmation、in-progress），但必须同时给到可操作控制（setup、
account、Runtime health、settings、Apps 入口）。

`MUST NOT`：首屏不得是 marketing copy、landing page、第三方 placeholder、
或 generic loading 屏。

## D-HOME-012 — Failure Projection As First-Class Surface

`MUST`：`failure-projection` 是 surface registry 的一等 surface。任何
upstream authority 非 ready 状态都必须经由该 surface 显式呈现给用户。

`MUST NOT`：不得把 multiple 非 ready 状态压缩成单一 `unavailable` /
`offline` 文案；不得隐藏失败原因或 dependency family identity。

## D-HOME-013 — Apps Desktop Open Targets

Desktop-hosted Nimi Home owns Apps surface placement and the Apps Desktop Open
targets recorded in `tables/apps-open-targets.yaml`. Platform Open Intent may
reference these targets, but it must not own Apps IA or app selection truth.

Admitted v1 targets are:

- `surface`: open the Apps surface without launching an app.
- `app-selection`: open the Apps surface and select an existing app when the
  optional `appId` resolves in the Apps projection.

Missing or unknown `appId` must not launch an app or fabricate Apps inventory
truth.

## Fact Sources

- `.nimi/spec/platform/product-lifecycle.authority.yaml` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/product-lifecycle.authority.yaml` — `P-SUPD-001..P-SUPD-008`
- `.nimi/spec/platform/product-lifecycle.authority.yaml` — `P-PKGREL-001..P-PKGREL-008`
- `.nimi/spec/platform/product-lifecycle.authority.yaml` — `P-COLD-001..P-COLD-008`
- `.nimi/spec/platform/core-protocol.authority.yaml` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/platform/core-protocol.authority.yaml` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/desktop/shell-ui.authority.yaml` — desktop shell 既有 `D-SHELL-*` 与本契约 placement 互不重叠
- `.nimi/spec/desktop/shell-runtime.authority.yaml` — desktop-host self-update implementation
- `.nimi/spec/desktop/ai-consumption.authority.yaml` — `D-AIPC-001..D-AIPC-012`
- `.nimi/spec/desktop/agent-projection.authority.yaml` — `D-LLM-022..D-LLM-026`
- `.nimi/spec/sdks/feature-clients.authority.yaml` — `S-AICONF-001..S-AICONF-006`
- `.nimi/spec/sdks/feature-clients.authority.yaml` — `S-RUNTIME-119`
- `.nimi/spec/platform/product-lifecycle.authority.yaml`
- `config/desktop-open-targets.yaml`

## Preserved source: Menu Bar Shell Contract

# Menu Bar Shell Contract

> Authority: Desktop Kernel

## Scope

macOS Desktop 顶栏入口（menu bar / status item）契约。定义 menu bar 作为 Desktop shell 的常驻入口时的状态投影、菜单动作、窗口生命周期与退出语义。

## D-MBAR-001 — Menu Bar Presence

Desktop 在 macOS 环境下必须支持 menu bar 常驻入口。

- menu bar 是 Desktop shell 的一部分，不是独立 runtime 进程。
- Phase 1 保留 Dock 图标与主窗口，不切换到 `ActivationPolicy::Accessory`。
- `enableMenuBarShell` feature flag 为 shell 是否启用 menu bar 入口的唯一门控。

## D-MBAR-002 — Status Projection

menu bar 状态数据固定来自两层：

1. **平台管理层**：service state through D-IPC-002 typed `status/start/restart`; no stop operation exists.
2. **应用健康层**：runtime/provider 细粒度健康通过现有 SDK runtime health APIs 投影，不新增 Tauri backend 平行 gRPC/HTTP health 路径。

menu bar 聚合状态至少包含：

- window visible / hidden
- daemon status
- runtime health summary
- provider summary
- in-flight daemon action
- lastUpdatedAt / lastError

如果 renderer 健康摘要超过 15s 未刷新，menu bar 必须回退到 daemon lifecycle 级别显示，不得继续显示陈旧的 provider/runtime health 细节。

## D-MBAR-003 — Menu Structure

Phase 1 menu bar 菜单固定包含以下区块：

1. **状态头**：`running / degraded / starting / stopped / unavailable`
2. **快捷入口**：`Open Nimi`、`Open Runtime Dashboard`、`Open Local Models`、`Open Cloud Connectors`、`Open Settings`
3. **状态摘要**：runtime health、provider summary、verified release、last check；不得显示或依赖 gRPC 地址、PID、binary path 或 managed/external selector
4. **操作区**：`Start Runtime`、`Restart Runtime`、`Refresh Status`
5. **退出区**：`Quit Nimi`

`Start Runtime` and `Restart Runtime` are enabled only when the fixed installed
service and platform-native code-signing verification are valid. There is no external-daemon mode,
binary selector, or stop action in production. Unverified/hung service state
routes to signed installer/service-updater repair.

## D-MBAR-004 — Navigation Dispatch

menu bar 的页面跳转必须遵循：

- backend 负责 `show/focus` 主窗口
- backend 通过 app event 向 renderer 发出导航事件
- renderer 负责更新 `activeTab` 与 runtime-config `activePage`

Phase 1 的 app event 固定为 `menu-bar://open-tab`，payload 仅允许：

- `{ tab: 'runtime', page?: 'overview' | 'profiles' | 'models' | 'cloud' | 'environment' | 'advanced' }`
- `{ tab: 'settings' }`

menu bar 不得直接耦合具体 React 组件实例。

## D-MBAR-005 — Close-To-Hide And Quit

在启用 menu bar shell 的 macOS Desktop 中：

- 主窗口 `CloseRequested` 必须被拦截并转为 `hide window`
- `Open Nimi` 必须恢复并聚焦主窗口
- 只有显式 `Quit Nimi`、系统级 Quit 或等效 quit path 才允许触发 app 退出

Quit path 必须执行：

1. 停止前端轮询 / auth watcher 等 shell cleanup
2. 退出应用进程

Production Runtime is an independent OS service and remains running across
Desktop hide, window close, renderer reload, crash, and explicit quit.

## Fact Sources

- `.nimi/spec/desktop/shell-runtime.authority.yaml` — 退出路径与 daemon 生命周期
- `.nimi/spec/desktop/bridge-ipc.authority.yaml` — daemon lifecycle / health sync IPC authority
- `ui-shell-contract.md` — shell feature flag 与入口语义
- `config/desktop-ipc-commands.yaml` — non-authoritative menu bar IPC command inventory

## Preserved source: Desktop Kit UI Consumption Contract

# Desktop Kit UI Consumption Contract

This contract owns Desktop-specific consumption of `@nimiplatform/kit/ui`.
The platform design spec owns shared primitives, tokens, theme schema, material
taxonomy, and generic validation rules. Desktop owns its concrete renderer
inventory, retained app-owned compositions, and controlled exceptions.

## D-SHELL-090 — Local Kit Consumption Authority

- Desktop kit consumption inventory lives in `tables/nimi-kit-adoption.yaml`.
- Desktop retained UI compositions live in `tables/nimi-kit-compositions.yaml`.
- Desktop design allowlists for kit governance live in `tables/nimi-kit-allowlists.yaml`.
- Platform design tables must not contain Desktop module inventories or
  Desktop-owned component rows.

## D-SHELL-091 — Theme Entry

- Desktop renderer must import `@nimiplatform/kit/ui/styles.css`,
  `light.css`, `dark.css`, and exactly one accent pack.
- Desktop uses `nimi-accent`.
- Desktop root rendering must use `NimiThemeProvider` from
  `@nimiplatform/kit/ui`.

## D-SHELL-092 — Controlled Exceptions

- Desktop controlled design exceptions are allowed only when registered in
  `tables/nimi-kit-adoption.yaml` with `exception_policy: controlled_exception`.
- Controlled exceptions still consume kit semantic tokens and must not define an
  independent shared primitive or token system.

## D-SHELL-093 — Chat Obstacle-Flow Consumer Boundary

- Desktop may consume `kit/features/chat` while injecting Desktop-owned
  occupancy geometry and obstacle-flow taxonomy into the canonical adapter path.
- This does not transfer canonical transcript shell, scroll-root, grouping, or
  virtualization truth from `kit/features/chat` to Desktop.
- Widening Desktop obstacle-flow semantics into shared kit ownership requires a
  separate platform authority cut.

## D-SHELL-094 — Renderer Shell Facade Boundary

- Desktop may retain local facade directories for Desktop-specific bridge
  modules.
- Shared renderer shell primitives must come from
  `@nimiplatform/kit/shell/renderer`; Desktop facades must not fork
  shared bridge primitive semantics.

## D-SHELL-095 — Local Avatar Binding Consumer Boundary

- Desktop may pass already-resolved Avatar/Runtime avatar presentation
  projections into `kit/features/avatar`.
- Desktop does not own Agent Center avatar/background picker, copy, validation,
  or custody transport. It injects the standard Kit Shell `agent-center`
  capability; Kit Shell owns the managed host-local bytes and asset-scoped
  custody metadata, while Runtime owns the selected opaque refs.
- Local VRM or Live2D refs must arrive at kit surfaces as Avatar/Runtime
  projections or typed host-transport callbacks, not as arbitrary file-system
  product truth.

## D-SHELL-096 — Retired Live2D / VRM Viewport Consumer Boundary

- Desktop MUST NOT ship a concrete Live2D, VRM, Cubism, or Three.js avatar
  viewport locally.
- Desktop may consume `kit/features/avatar` and `kit/features/agent-center`
  only for normalized presentation, evidence, and launch-control surfaces.
- Concrete avatar renderer execution belongs to the Runtime-admitted Avatar app
  and its Avatar/Runtime resource resolver path, not the Desktop shell.
- Absence of a shared Kit renderer export must fail closed; it must not create a
  Desktop-local fallback renderer or lifecycle path.

## D-SHELL-097 — Pointer Attention Consumer Boundary

- Desktop owns raw attention intake, DOM pointer capture, app viewport
  measurement, attention smoothing, clamp policy, and surface stop-line policy.
- `kit/features/avatar` may consume already-resolved Desktop attention targets,
  continuous presence, and bounded app-attention-follow inputs.
- Kit avatar renderer seams must not become the semantic owner of
  speaking-vs-attention precedence or Desktop attention lifecycle truth.

## D-SHELL-098 Agent Center Kit Consumer Boundary

Desktop Agent Center consumes `kit.features.agent-center` as the reusable
Runtime Local Agent product surface.

Desktop owns only:

- Agent Center placement in Desktop shell chrome
- close/open settings callbacks and other Desktop navigation outside Kit core
- scoped Runtime SDK adapter attachment
- Kit Shell host bridge injection for the standard `agent-center` capability
- typed Avatar launch bridge when admitted by Avatar/Desktop contracts
- evidence hooks for real app acceptance

Desktop must not:

- keep a reusable Desktop-owned Agent Center implementation after the Kit
  hardcut
- inject `ChatSettingsPanel`, arbitrary `modelContent`, `diagnosticsContent`,
  `avatarContent`, `localAppearanceContent`, or equivalent app panels into Kit
  Agent Center
- derive Agent Chat submit readiness from Desktop AIConfig,
  `ConversationCapabilityProjection.resolvedBinding`, route cache, or
  `AISnapshot`
- derive route/model/provider diagnostics from app-local AIConfig or
  conversation capability bindings
- persist Runtime Agent lifecycle, memory, transcript, model route, provider,
  turn execution truth, or Agent Center presentation selection truth

Retired local config module ownership for Desktop Agent Center:

| Module | Owner Decision |
| --- | --- |
| `appearance` / `avatar_asset` | Retired as Desktop local config. Selection truth is Runtime `AgentPresentationProfile`; asset bytes and validation are Kit Shell `agent-center` custody. |
| `local_history` | Dropped without replacement. |
| `voice.avatar_autoplay` | Retired as host-local preference. Runtime `AgentPresentationProfile.avatar_autoplay` is the single persistent home. |
| `ui.last_section` | Dropped without replacement. |

Desktop must not expose `AgentCenterLocalConfig`, `desktop_agent_center_*`,
or app-local Agent Center config get/set/import/resource-management bridges
after the hardcut.

`audio.synthesize` and `voice_workflow.*` are editable only through Kit Agent
Center typed Runtime Agent AI Config controls. Desktop must not render an
app-local audio binding surface, generate voice, or present a playable pseudo
voice artifact as Agent Center truth.

## Fact Sources

- `tables/nimi-kit-adoption.yaml`
- `tables/nimi-kit-compositions.yaml`
- `tables/nimi-kit-allowlists.yaml`

## Preserved source: Error Boundary Contract

# Error Boundary Contract

> Authority: Desktop Kernel

## Scope

Desktop 错误边界契约。定义 bridge 错误归一化、错误码映射、用户可读消息转换、重试策略。

## D-ERR-001 — Local AI 错误码

本地 AI 模型管理相关错误（参考 `tables/error-codes.yaml`）：

- `LOCAL_AI_IMPORT_*`：导入路径、清单、哈希校验错误。
- `LOCAL_AI_MODEL_*`：模型不存在、哈希为空、能力无效。
- `LOCAL_AI_HF_DOWNLOAD_*`：下载中断/暂停/取消、磁盘不足、不可恢复失败。
- 所有错误通过 `BRIDGE_ERROR_CODE_MAP` 映射为中文用户消息。

## D-ERR-002 — Endpoint 安全错误码

- `LOCAL_AI_ENDPOINT_NOT_LOOPBACK`：端点非回环地址。
- `LOCAL_AI_ENDPOINT_INVALID`：端点格式无效。

安全要求：本地运行时端点仅支持 `localhost` / `127.0.0.1` / `[::1]`。

## D-ERR-003 — Speech Bundle Download / Init 错误码

baseline local speech 的 Desktop 错误投影必须按 bundle-aware download/init 语义解释，而不是按单一 `Qwen TTS bootstrap` 语义解释。

Speech 引擎依赖检查错误：

- `LOCAL_AI_SPEECH_GPU_REQUIRED`：Speech 引擎需要可用 NVIDIA GPU。
- `LOCAL_AI_SPEECH_PYTHON_REQUIRED`：Speech 引擎需要 Python 3.10+。
- `LOCAL_AI_SPEECH_PYTHON_VERSION_UNSUPPORTED`：Speech 引擎 Python 版本过低。
- `LOCAL_AI_SPEECH_BOOTSTRAP_FAILED`：`Local Speech` bundle 的 env/bootstrap 或依赖初始化失败；不得在用户文案中收口成单一 `Qwen TTS bootstrap failed`。

这些 `LOCAL_AI_SPEECH_*` 码只允许作为 bridge 诊断 alias 保留。
当 runtime 已返回 `AI_LOCAL_SPEECH_*` canonical ReasonCode family 时，
Desktop 主流程必须优先消费 runtime ReasonCode，而不是反向退回 alias code。

## D-ERR-003a — Speech Bundle 用户文案分层

Desktop 必须把 baseline local speech 失败至少投影为以下 bundle-aware failure families：

- `preflight_blocked`：GPU/Python/版本等前置条件不满足
- `download_or_init_failed`：用户显式点击 `Download` 之后，env/bootstrap 或 host readiness 失败
- `capability_materialization_failed`：目标 capability 对应模型/工件下载或校验失败
- `bundle_degraded`：既有 speech bundle slice 退化，需 repair

固定规则：

- 当 failing slice 或 capability 已知时，用户文案必须优先使用 `Local Speech` + slice/capability（如 `STT`、`TTS`、`voice_workflow.voice_clone`、`voice_workflow.voice_design`），不得默认退化为 `Qwen TTS`。
- `LOCAL_AI_SPEECH_BOOTSTRAP_FAILED` 可以保留为 bridge 诊断别名，但 canonical 用户文案不得把所有 local speech 失败压成同一个 bootstrap 句式。
- helper IPC / Tauri 相关失败只允许描述 runtime-owned speech bundle projection 失败，不得暗示 Desktop/Tauri 是安装真源。

## D-ERR-004 — Runtime 路由错误码

- `LOCAL_LIFECYCLE_WRITE_DENIED`：source type 无权执行生命周期写操作。
- `RUNTIME_ROUTE_CAPABILITY_MISMATCH`：路由绑定的模型能力不匹配。

## D-ERR-005 — Bridge 错误归一化

`toBridgeNimiError(error)` 是 Desktop bridge 的 canonical 结构化错误归一化 helper，必须返回/抛出结构化 `NimiError`，并遵循固定优先级：

1. 输入已是 `NimiError`：保持结构化字段不变。
2. 可解析 JSON payload：提取 `reasonCode/actionHint/traceId/retryable/message`。
3. `CODE:` 前缀：提取前缀作为 `reasonCode`。
4. 正则模式映射：仅用于用户展示文案推断。
5. 兜底：`RUNTIME_CALL_FAILED`。

显示层规则：

- 中文提示仅写入 `details.userMessage`。
- `message` 与 `reasonCode` 必须保留上游原值，不可被 UI 文案覆盖。
- `details.rawMessage` 必须保留原始失败文本，便于排障。

## D-ERR-006 — Bootstrap 错误边界

`bootstrapRuntime()` 的 `.catch()` 处理：

- 设置 `bootstrapError = message`。
- 设置 `bootstrapReady = false`。
- 清除 auth session。
- 记录 `phase:bootstrap:failed` error 日志。
- 重新抛出错误。

This boundary belongs to the Desktop production binding only. Simulator never
calls `bootstrapRuntime()` and cannot manufacture this success/failure state.
Renderer/Adapter faults in Simulator retain the closed `P-SIM-019` instance,
module, or session scope and must not leak `SIMULATOR_*` codes into Desktop UI
or host-neutral SDK errors.

## D-ERR-007 — Runtime ReasonCode 投影链

Runtime 错误通过三层投影到 Desktop UI：

**投影路径**：Runtime K-ERR ReasonCode → SDK S-ERROR / runtime reason-code
message projection → Desktop bridge consumption.

Desktop `toBridgeNimiError` may translate Desktop-local bridge/OS error codes,
but it must not re-own Runtime ReasonCode message coverage. Runtime ReasonCode
defaults are consumed from the SDK projection, and D-ERR-007 gates must validate
that SDK projection instead of requiring Runtime reason-code literals inside
Desktop bridge source.

**关键 ReasonCode UI 映射**：

| Runtime ReasonCode | SDK 投影 | Desktop UI 消息 |
|---|---|---|
| `AI_PROVIDER_TIMEOUT` | `S-ERROR-007` retryable | "AI 服务超时，请稍后重试" |
| `AI_PROVIDER_UNAVAILABLE` | `S-ERROR-007` retryable | 上下文感知映射（见下文 D-ERR-007a） |
| `AI_PROVIDER_RATE_LIMITED` | `S-ERROR-007` retryable | "AI 服务繁忙，请稍后重试" |
| `AI_PROVIDER_INTERNAL` | `S-ERROR-001` 上游错误 | "AI 服务内部错误，请稍后重试" |
| `AI_PROVIDER_ENDPOINT_FORBIDDEN` | `S-ERROR-001` 上游错误 | "AI 服务端点被安全策略拒绝" |
| `AI_STREAM_BROKEN` | `S-ERROR-004` 不自动重连 / `S-ERROR-007` 应用层可重试 | "流式响应中断，请重新发送" |
| `AI_CONNECTOR_CREDENTIAL_MISSING` | `S-ERROR-001` 上游错误 | "缺少 AI 服务凭证，请检查配置" |
| `AI_CONNECTOR_DISABLED` | `S-ERROR-001` 上游错误 | "AI 连接器已禁用" |
| `AI_CONNECTOR_NOT_FOUND` | `S-ERROR-001` 上游错误 | "AI 连接器未找到" |
| `AI_MODEL_NOT_FOUND` | `S-ERROR-001` 上游错误 | "AI 模型未找到，请检查模型配置" |
| `AI_MODALITY_NOT_SUPPORTED` | `S-ERROR-001` 上游错误 | "当前模型不支持此功能类型" |
| `AI_LOCAL_MODEL_UNAVAILABLE` | `S-ERROR-001` 上游错误 | "本地模型未运行，请先启动模型" |
| `AI_FINISH_LENGTH` | gRPC OK（非错误） | 消息气泡底部标注"输出已达最大长度"（非 toast，不阻断交互） |
| `AI_FINISH_CONTENT_FILTER` | gRPC OK（非错误） | 消息气泡底部标注"内容因安全策略被截断"（非 toast，不阻断交互） |
| `AI_MEDIA_IDEMPOTENCY_CONFLICT` | `S-ERROR-001` 上游错误 | "请求重复，请勿重复提交"（K-ERR-007 **强制显式处理**，不允许走通用兜底） |
| `AI_MEDIA_JOB_NOT_FOUND` | `S-ERROR-001` 上游错误 | "媒体任务未找到" |
| `AI_PROVIDER_AUTH_FAILED` | `S-ERROR-001` 上游错误 | "AI 服务凭证已失效，请重新配置" |
| `AI_MODEL_PROVIDER_MISMATCH` | `S-ERROR-001` 上游错误 | "模型与引擎类型不匹配，请检查模型配置" |
| `AI_MEDIA_SPEC_INVALID` | `S-ERROR-001` 上游错误 | "媒体生成参数无效，请检查输入" |
| `AI_MEDIA_OPTION_UNSUPPORTED` | `S-ERROR-001` 上游错误 | "当前不支持此媒体生成选项" |
| `AI_MEDIA_JOB_NOT_CANCELLABLE` | `S-ERROR-001` 上游错误 | "任务已完成，无法取消" |
| `AI_LOCAL_MODEL_PROFILE_MISSING` | `S-ERROR-001` 上游错误 | "本地模型缺少推理配置文件" |
| `AI_LOCAL_ASSET_ALREADY_INSTALLED` | `S-ERROR-001` 上游错误 | "资产已安装，无需重复安装" |
| `AI_LOCAL_ENDPOINT_REQUIRED` | `S-ERROR-001` 上游错误 | "本地引擎需要配置端点地址" |
| `AI_LOCAL_TEMPLATE_NOT_FOUND` | `S-ERROR-001` 上游错误 | "模型模板未找到" |
| `AI_LOCAL_MANIFEST_INVALID` | `S-ERROR-001` 上游错误 | "模型清单格式无效，请检查文件" |
| `AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED` | `S-ERROR-001` 上游错误 | "Local Speech 无法初始化，请先满足本地环境前置条件" |
| `AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED` | `S-ERROR-001` 上游错误 | "Local Speech 需要先确认下载后才能继续" |
| `AI_LOCAL_SPEECH_ENV_INIT_FAILED` | `S-ERROR-001` 上游错误 | "Local Speech 环境初始化失败，请重试或修复安装" |
| `AI_LOCAL_SPEECH_HOST_INIT_FAILED` | `S-ERROR-001` 上游错误 | "Local Speech 服务启动失败，请检查本地语音环境" |
| `AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED` | `S-ERROR-001` 上游错误 | "Local Speech 所需能力下载失败，请重试该能力" |
| `AI_LOCAL_SPEECH_BUNDLE_DEGRADED` | `S-ERROR-001` 上游错误 | "Local Speech 当前已降级，需要修复后才能继续" |
| `AI_CONNECTOR_INVALID` | `S-ERROR-001` 上游错误 | "连接器配置无效，请检查输入" |
| `AI_CONNECTOR_IMMUTABLE` | `S-ERROR-001` 上游错误 | "该连接器字段不可修改" |
| `AI_CONNECTOR_LIMIT_EXCEEDED` | `S-ERROR-001` 上游错误 | "连接器数量已达上限" |
| `AUTH_REVOCATION_UNAVAILABLE` | `S-ERROR-007` retryable | "认证撤销检查暂时不可用，请重试" |
| `AUTH_TOKEN_INVALID` | `S-ERROR-001` 上游错误（**不可重试**） | "认证令牌无效，请重新登录" |
| `SESSION_EXPIRED` | `S-ERROR-007` retryable | "会话已过期，请重新登录" |
| `APP_MODE_DOMAIN_FORBIDDEN` | `S-ERROR-001` 上游错误（**不可重试**） | "应用权限不足，请检查应用模式配置" |
| `APP_MODE_SCOPE_FORBIDDEN` | `S-ERROR-001` 上游错误（**不可重试**） | "应用权限不足，请检查应用模式配置" |
| `APP_MODE_MANIFEST_INVALID` | `S-ERROR-001` 上游错误（**不可重试**） | "应用模式配置无效" |
| `RUNTIME_UNAVAILABLE` | SDK 合成码 | "本地运行时不可用，请检查 daemon 状态" |
| `RUNTIME_BRIDGE_DAEMON_UNAVAILABLE` | SDK 合成码 | "无法连接到运行时服务" |

## D-ERR-007a `AI_PROVIDER_UNAVAILABLE` 上下文感知映射

Runtime K-PROV-003 指出 provider 健康探测将 `401`/`403` 视为 healthy（server 可达）。因此 provider 显示 healthy 但 consume 持续返回 `AI_PROVIDER_UNAVAILABLE` 时，根因是凭据问题而非网络问题。Desktop 应结合 provider 健康状态（D-IPC-002 可获取）差异化引导用户：

| Provider 健康状态 | UI 消息 | 引导方向 |
|---|---|---|
| `healthy` | "AI 服务凭证可能已失效，请检查 API key 配置" | 凭据配置诊断 |
| `unhealthy` 或 `unknown` | "AI 服务暂时不可用" | 网络连通性诊断 |
| Phase 1 简化（provider 健康细粒度不可用时） | "AI 服务暂时不可用"（通用兜底） | — |

Phase 1 provider 健康细粒度展示为 Phase 2（D-IPC-002），因此 Phase 1 使用通用兜底消息。Phase 2 实现 provider 级健康指示器后，必须启用上下文感知映射。

注：`ListConnectorModels` 失败也复用此 ReasonCode（K-ERR-005），此场景无 provider 健康上下文，走通用兜底。

**跨层引用**：K-PROV-003（健康探测设计取舍）、D-IPC-002（provider 健康 UI 映射）。

**非错误终态说明**：`AI_FINISH_LENGTH` 和 `AI_FINISH_CONTENT_FILTER` 通过 gRPC OK + `reason_code` 返回（参考 SDK S-ERROR-009），投影为 `finishReason` 而非异常。UI 不触发错误边界（D-ERR-006），仅在消息元信息区域展示提示标注。

**认证失效投影**：Runtime read surface 返回 `AUTH_TOKEN_INVALID` 时，Desktop UI 投影为 `invalid_requires_reauth`，除非目标 RPC 已在 Runtime/SDK authority 中声明为匿名可读。`AUTH_REVOCATION_UNAVAILABLE` 表示撤销内省临时不可判定，必须作为 retryable unavailable 投影，不得清空会话或触发 reauth。匿名重试只适用于已准入的只读 Runtime surface，且 credential source 继续保留在诊断详情中。Runtime Config、Local AI、usage、audit、dependency setup 等读取路径都需要 bounded timeout、错误投影、stale 投影或认证失效投影，不能无限停留在 loading 文案。

**Local Speech 细化映射约束**：

- Desktop 不得再把 `AI_LOCAL_SPEECH_ENV_INIT_FAILED`、
  `AI_LOCAL_SPEECH_HOST_INIT_FAILED`、
  `AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED`、
  `AI_LOCAL_SPEECH_BUNDLE_DEGRADED` 统一收口成单一
  `LOCAL_AI_SPEECH_BOOTSTRAP_FAILED` 文案。
- 当 runtime metadata 携带 capability 或 bundle slice 时，Desktop 文案应优先
  投影为 `Local Speech / STT`、`Local Speech / TTS`、`Local Speech / voice_workflow.voice_clone`
  或 `Local Speech / voice_workflow.voice_design`，而不是 generic `Qwen TTS`。
- `AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED` 是显式用户动作 gate，不得被
  Desktop 自动转成后台下载重试。

**兜底规则**：未映射的 ReasonCode 走 D-ERR-005 多阶段归一化兜底路径，最终返回通用错误消息。

**未覆盖 ReasonCode 族群声明**：以下 ReasonCode 族群当前走通用兜底路径（"操作失败，请稍后重试"），对用户无诊断价值。Phase 2 服务消费契约就绪时应补充专用映射：

| ReasonCode 族群 | Runtime 来源 | 补充映射优先级 | 推荐消息方向 |
|---|---|---|---|
| `LOCAL_APP_*` 族 | K-ERR-012 | 高（Developer Mode / local app journey） | 区分未授权、已撤销、进程替换、账号切换、Runtime 重启、需重新确认与 owner-unavailable，并提供明确恢复动作 |
| `PAGE_TOKEN_INVALID` | K-PAGE-002 | 低（分页错误罕见） | "分页参数无效，请刷新重试" |
| `WORKFLOW_*` 族 | Phase 2 | 中（Workflow UI 启动时） | 待 K-WF-012 消费契约定义 |
| `APP_MESSAGE_*` 族 | K-APP-005 | 中（AppMessage UI 启动时） | 待 K-APP-006a 消费契约定义 |

**映射治理规则**：

- 当 `config/runtime-reason-codes.yaml` 新增 ReasonCode 且 `surface` 包含 `consume` 或 `connector` 时，必须评估是否需要添加 D-ERR-007 映射条目。
- 评估标准：该 ReasonCode 是否可能在 Desktop 用户操作流中触达。可通过 UI 触达的码必须添加中文映射；仅内部使用的码（如 management RPC 专用码）可跳过。
- 此评估应作为 reason-codes.yaml 变更 PR 的 review checklist 项。

**跨层引用**：Runtime `K-ERR-001~010`、SDK `S-ERROR-001~015`。

## D-ERR-008 — 本地模型生命周期 NOT_FOUND 映射

Runtime K-ERR-008 规定 `StartLocalAsset`、`StopLocalAsset`、`RemoveLocalAsset` 对不存在的 `local_model_id` 返回 `NOT_FOUND`。Desktop D-IPC-011 调用这些命令时需处理此错误。

**映射规则**：

| IPC 命令 | gRPC 状态 | UI 行为 |
|---|---|---|

**跨层引用**：Runtime K-ERR-008、K-LOCAL-009。

## D-ERR-009 — runtime-config Fail-Fast 约束

runtime-config 关键链路（connector discovery、provider/model 列表、route capabilities）必须 Fail-Fast：

- 禁止静默吞错：不允许 `.catch(() => [])`、`.catch(() => {})`、空 `catch {}`
- 失败必须抛 `NimiError`，UI 必须显示错误 banner
- banner 至少包含 `reasonCode` 与 `traceId`（若存在）
- 不允许以本地目录（`VENDOR_CATALOGS_V11`）作为 runtime 不可用时的模型事实源回退

Runtime 不可用时，用户操作必须显式失败，不允许伪成功。

## D-ERR-010 — Desktop Runtime Invoke Bridge 主码规则

Desktop runtime execution bridges（当前 Nimi Chat streaming Runtime/SDK path，以及 `runtime-bootstrap-host-capabilities.ts` 注册的 runtime host 能力桥）错误处理必须遵循：

- 统一抛出 `NimiError`，禁止 `throw new Error(normalizedError)` 降维
- 主判定码使用 Runtime `reasonCode`
- `LOCAL_AI_*` 仅作为诊断别名记录在审计字段 `extra.localReasonCode`，不参与主流程分支
- 每次 runtime 调用 metadata 必须携带 `traceId`，保证 renderer 日志、runtime 审计与异常对象可对齐

## D-ERR-011 — Bridge 日志可观测字段

Bridge invoke 失败日志必须输出结构化诊断字段：

- `reasonCode`
- `actionHint`
- `traceId`
- `retryable`
- `rawMessage`

## D-ERR-012 — HuggingFace 下载错误动作提示

下载会话控制与容错错误必须映射为明确动作提示：

| ReasonCode | 用户提示 | 后续动作 |
|---|---|---|
| `LOCAL_AI_HF_DOWNLOAD_DISK_FULL` | "磁盘空间不足，请释放空间后继续下载" | 保留 partial，用户清理空间后 `resume` |
| `LOCAL_AI_HF_DOWNLOAD_INTERRUPTED` | "下载已中断，重启后请手动恢复任务" | 会话保留 `paused`，用户手动 `resume` |
| `LOCAL_AI_HF_DOWNLOAD_PAUSED` | "下载已暂停，可稍后继续" | 保留 partial，用户手动 `resume` |
| `LOCAL_AI_HF_DOWNLOAD_CANCELLED` | "下载已取消" | 清理 staging，需重新安装 |
| `LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH` | "模型文件校验失败，请重新下载" | 清理 staging，禁止 `resume`，需重新安装 |
| `LOCAL_AI_HF_DOWNLOAD_NOT_RESUMABLE` | "当前下载会话不可恢复，请重新安装模型" | 明确阻断 `resume`，引导重新安装 |

## Fact Sources

- `tables/error-codes.yaml` — Desktop 错误码

## Preserved source: DevTools And Developer Mode Contract

# DevTools And Developer Mode Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop `Developer Tools` 表面与 `Developer Mode` 门控的产品语义：
Developer Mode 的可发现切换入口、DevTools 表面的门控、developer diagnostics
的可见性默认值。

`Developer Tools` 是一个 developer/internal 表面，不是 ordinary primary
navigation tab。它只在 admitted Developer Mode 开启时可达。

本契约取代并收口 `D-SHELL-009` 中关于 Developer Mode 入口的笼统描述：
`D-SHELL-009` 仍保留为 `ui-shell` 的导航锚点，本契约（`D-DEV-*`）
拥有 Developer Mode 门控与 DevTools 表面的完整规则集。

## D-DEV-001 — Developer Tools As Gated Developer Surface

`MUST`：`Developer Tools` 必须注册为 `app-tabs.yaml` 中
`nav_group: developer` 的表面，并由 feature flag `enableDeveloperTools` 门控。
它只在 admitted Developer Mode 开启时可达。

`MUST NOT`：`Developer Tools` 不得进入 ordinary primary navigation；它不得
出现在 ordinary-user Nimi Home close evidence；ordinary primary navigation
必须保持恰好 5 项：`Home`、`Chat`、`Explore`、`Apps`、`Runtime`。

## D-DEV-002 — Discoverable Developer Mode Toggle

`MUST`：Developer Mode 的开启、关闭与当前状态展示必须位于 App 内一个可发现
位置——canonical 位置为 `Settings`。Developer Mode 不得仅能通过启动参数、
环境变量或隐藏快捷键进入。

`MUST`：Developer Mode 默认为关闭。只有用户在可发现入口显式开启后，
`Developer Tools` 表面与 developer-only surface 才变为可达。

`MUST NOT`：第三方开发者使用 Desktop 时，不得被要求通过启动参数
或环境变量进入主要开发路径。

## D-DEV-003 — DevTools Surface Composition

`MUST`：`Developer Tools` 表面在 Developer Mode 下承载：

- 开发态技术诊断入口（technical diagnostics）。

`MUST`：先前孤立、未接入任何可达路由的 Developer 页面（`DeveloperPage`）必须
被接入此表面，且仅在 Developer Mode 下可达。它不得保持为无入口的 orphan
surface，也不得在 Developer Mode 关闭时可达。

`MUST NOT`：`Developer Tools` 不得承载 ordinary-user 产品功能；ordinary
product path 不得依赖 `Developer Tools` 的存在或可达性。

## D-DEV-004 — One Production Developer Mode And Dev Trust Set

`MUST`：Desktop 只提供一个 production `Developer Mode` 与一个 `Dev Trust
Set`。已登录 production account 可以使用；mode 默认关闭，开启本身不授予任何
Nimi API permission，也不创建 principal、grant、lease 或 session。

`MUST NOT`：不得提供 test-only service principal、dev daemon、environment
toggle、hidden mode、direct `go run ... serve`、renderer auth、localhost trust
或第二套 developer account/session truth。

## D-DEV-005 — Local Development Lifetimes And Invalidation

`MUST`：项目 decision lifetime 只有 `run_once` 与 `allow_project`。
`allow_project` 是 Runtime-owned 持久项目 consent；run 结束、Desktop 重启、
Runtime restart/upgrade/reinstall、mode off 与 account 暂时离开不得要求重复
presence，也不得自动启动。每次显式 dev launch、edit/build/process replacement
和 Runtime boot epoch 变化都必须按 Runtime 规则产生新 lease/session，旧
process/session 不得继承。revoke、project/account/permission/shell/entry/risk
binding 变化必须重新批准或立即 deny。

`MUST`：Desktop 必须把 zero-permission session 与独立的 product permission
posture 分开呈现；不得把 project admitted、process running 或 session open
显示成 permission approved。当前权限目录全部 reserved 时，不得渲染伪造的
approve/revoke 管理中心。

## D-DEV-006 — Native Execution Risk And Failure UX

`MUST`：确认面必须明确告知本地项目将在 Windows 原生进程中执行、可访问其
OS user 权限范围内的资源，而 Nimi API 仍受独立 permission/owner policy 限制。首次
批准及 disclosure revision 变化后必须重新确认。

`MUST`：UI 必须有可判定的 loading、disabled、retry、no-grant、grant-approved、
Runtime-unavailable、account-switched、revoked、build-failed、process-replaced
与 Runtime-restarted 状态；长 project/error/capability 文本和窄屏不得溢出或
隐藏主要动作。

`MUST NOT`：不得用 fail-closed shell、toast-only failure、console message、
隐式 retry 或假成功替代真实状态与恢复动作。

## D-DEV-007 — Developer Surface Visibility Default

`MUST`：所有 developer / internal surface（`Developer Tools`、
developer diagnostics）的默认可见性为不可见 / 不可达。
它们只在 admitted Developer Mode 显式开启后变为可达。

`MUST NOT`：任何 developer / internal surface 不得在默认安装态对 ordinary
用户可见或可达；不得通过 default-true feature flag 把 developer surface
默认暴露给 ordinary 用户。

## Fact Sources

- `.nimi/spec/desktop/shell-ui.authority.yaml` — `D-SHELL-001`, `D-SHELL-002`, `D-SHELL-009`
- `.nimi/spec/desktop/product-surfaces.authority.yaml` — `D-SUP-001..D-SUP-008`
- `config/desktop-shell-ui-app-tabs.yaml`
- `.nimi/spec/desktop/shell-runtime.authority.yaml` — `rule.nimi.desktop.shell-runtime.r042`

## Preserved source: Telemetry Contract

# Telemetry Contract

> Authority: Desktop Kernel

## Scope

Desktop 遥测日志契约。定义结构化日志格式、日志级别、区域枚举、流 ID 追踪、消息格式约定。

## D-TEL-001 — 日志载荷结构

`RuntimeLogPayload`：

```typescript
{
  level?: 'debug' | 'info' | 'warn' | 'error';
  area: string;          // 日志区域（参考 tables/log-areas.yaml）
  message: string;       // 格式化消息
  traceId?: string;      // 会话追踪 ID
  flowId?: string;       // 流程追踪 ID
  source?: string;       // 来源标识
  costMs?: number;       // 耗时（毫秒）
  details?: Record<string, unknown>;  // 附加详情
}
```

## D-TEL-002 — 消息格式约定

消息必须符合两种前缀之一：

- `action:<name>` — 动作类日志（如 `action:invoke-start:http_request`）
- `phase:<name>` — 阶段类日志（如 `phase:bootstrap:done`）

归一化：`normalizeRuntimeLogMessage` 自动添加 `action:` 前缀。

## D-TEL-003 — Logger 注入

`setRuntimeLogger(logger)` 注入运行时 logger：

- 非空时：日志转发到注入的 logger 函数。
- 为空时：回退到 `console.*`（`fallbackConsoleLog`）。
- 启动序列中在 `bootstrapRuntime()` 入口处注入（早于 `D-BOOT-001`），通过 `desktopBridge.logRendererEvent` 转发到 Tauri backend。

## D-TEL-004 — 流程追踪 ID

`createRendererFlowId(prefix)` 生成唯一流程 ID：

- 格式：`${prefix}-${timestamp}-${random}`
- 用途：关联同一流程的多条日志（如 bootstrap 流程）。

## D-TEL-005 — Bridge 调用追踪

每次 `invoke()` 调用生成追踪信息：

- `invokeId`：`${command}-${timestamp}-${random}`（格式由 `D-IPC-009` 定义）
- `sessionTraceId`：renderer 会话级追踪 ID。
- 日志事件：`invoke-start`（info）、`invoke-success`（debug）、`invoke-failed`（error）。

## D-TEL-006 — Renderer 日志转发

Renderer 日志通过 IPC 转发到 Tauri backend：

- `RendererLogPayload` 与 `RuntimeLogPayload` 结构对齐。
- `toRendererLogMessage()` 确保消息格式正确。

## D-TEL-007 — 网络层日志区域

`net` 日志区域用于网络重试事件和错误归一化日志：

- 重试事件：`action:retry:retrying`、`action:retry:recovered`、`action:retry:retry_exhausted`。
- 日志级别：retrying=warn、recovered=info、exhausted=error。
- 来源：SDK vNext `sdks/typescript/types/network-retry.ts` 中的 shared retry helper。

## D-TEL-008 — 全局 trace_id 传播

所有 bridge 错误对象和日志条目在 upstream 提供 `trace_id` 时必须保留并传播，不限于 LLM 路径。

**覆盖范围**：

- **LLM 路径**：D-LLM-008 已覆盖（text/image/video/stt/embedding/speech）。
- **Realm feature-data 错误**：`emitRealmDataError` 产生的错误对象，若 upstream 响应包含 `trace_id`，必须保留。
- **Auth 错误**：D-AUTH-006/007 token 刷新失败时，若 upstream 返回 `trace_id`，错误对象必须携带。
- **Bridge invoke 错误**：D-ERR-011 已要求 `traceId` 为必输出字段，本规则确认此要求覆盖所有 bridge 路径。

**传播规则**：

- upstream 提供 `trace_id` 时：错误对象 `traceId` 字段 = upstream 值。
- upstream 未提供 `trace_id` 时：不强制生成（仅 D-LLM-008 规定的 LLM 路径需生成 fallback trace）。

**跨层引用**：K-AUDIT-019（trace_id 全层级保留）、K-AUDIT-020（trace_id 传播要求）。

## Fact Sources

- `tables/log-areas.yaml` — 日志区域枚举
