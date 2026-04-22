# UI Shell Contract

> Authority: Desktop Kernel

## Scope

Desktop UI Shell 契约。定义导航 Tab 体系、布局结构、路由映射、i18n 规范、主题约定、Vite 分包策略。

## D-SHELL-001 — 导航 Tab 体系

导航由 `navigation-config.tsx` 定义，分为三组：

1. **Core Nav**（`getCoreNavItems()`）：home、chat、contacts、world、explore、runtime（gated）、settings
2. **Mod Nav**（sidebar puzzle icon）：mods（gated by `enableModUi`）— 点击直接进入 Mod Hub
3. **Detail Tab**：profile、agent-detail、world-detail、notification、gift-inbox、privacy-policy、terms-of-service

Feature flag 门控：
- `enableRuntimeTab` 控制 runtime tab 可见性。
- `enableModUi` 控制 mods tab 可见性（sidebar puzzle icon + guard clause）。

## D-SHELL-002 — Mod UI 扩展

Mod UI 通过 feature flag 门控：

- `enableModUi`：启用 mod 组件渲染 + Mods Panel + sidebar puzzle icon。
- `enableModWorkspaceTabs`：启用 mod workspace tab 管理。
- `enableSettingsExtensions`：启用 settings panel 扩展区域。

Mods Panel（`features/mods/mods-panel.tsx`）直接承载单页 Mod Hub：
- 侧边栏 puzzle icon 直接导航到 `activeTab = 'mods'`。
- `Mods` 打开后直接展示 Mod Hub，而不是旧的双视图结构。
- Mod Hub 统一负责发现、安装、更新、启用、禁用、卸载，以及通过 `Open Mods Folder` 暴露本地 installed mods 目录入口。
- Disable / Uninstall 当前激活 mod 时 fallback 到 `'mods'` tab。
- Guard clause：`enableModUi = false` 时访问 `'mods'` tab 自动回退到 `'chat'`。

`ui-extension.app.sidebar.mods` slot 仍可供 mods 注册额外导航项（参考 `D-HOOK-004`）。

## D-SHELL-003 — 窗口管理

- `enableTitlebarDrag`：启用原生窗口拖拽（desktop only）。
- `start_window_drag` IPC 命令触发拖拽操作。
- Web 模式下所有窗口管理操作禁用。
- `enableMenuBarShell`：启用 macOS menu bar 顶栏入口（desktop macOS only）。关闭主窗口时的 hide-vs-quit 语义由 `D-MBAR-005` 定义。

## D-SHELL-004 — Vite 分包策略

代码分割策略：

- **同步加载**：shell-core、bridge（首屏必需）。
- **懒加载**：chat、contacts、explore、settings、profile、runtime-view、mod-ui、local-ai、external-agent。

懒加载通过 `React.lazy(() => import(...))` 实现，配合 `Suspense` 边界。

## D-SHELL-005 — i18n 规范

- 翻译框架：`react-i18next`。
- 导航 label 使用 `t('Navigation.${id}', { defaultValue: item.label })`。
- locale 文件：`locales/en.json`、`locales/zh.json`。
- 缺失翻译 key 时，renderer 必须发出可观测 issue（例如通过 i18n issue listener / diagnostics surface），并返回人类可读 fallback 文案；不得因 missing key 直接抛错或触发 render crash。
- 缺失翻译属于内容完整性缺陷，不属于 renderer 可用性致命错误；Desktop 不得把 missing key 当作阻断 UI 渲染的 fail-close 条件。
- bundle 加载失败仍必须记录 error 级 issue，并允许受控回退到 `en` 资源，但单个 key 缺失不得升级成 app-unavailable 故障。

## D-SHELL-006 — 布局结构

`MainLayoutView` 定义两栏布局：

- **左侧 sidebar**：可折叠，包含 core nav + mod nav + profile。
- **右侧 content**：根据 `activeTab` 渲染对应面板。

Content 面板映射：
- `chat` → `ChatPage`
- `contacts` → `ContactsPanel`
- `world` → `WorldList`
- `explore` → `ExplorePanel`
- `settings` → `SettingsPanel`
- `profile` → `ProfilePanel`（承载共享 profile detail surface）
- `gift-inbox` → `GiftInboxPanel`（礼物交易列表与详情入口，作为 full-page detail route）
- `runtime` → `RuntimeView`
- `mods` → `ModsPanel`（gated by `enableModUi`）
- `mod:*` → `ModWorkspacePanel`

## D-SHELL-007 — 图标系统

`renderShellNavIcon(icon)` 提供内联 SVG 图标：

- 支持的图标名：home、chat、contacts、explore、runtime、profile、settings、store、globe、wallet、agent/agents/my-agents/bot、terms/file/document、privacy/shield、logout
- 未知图标名回退到 puzzle 图标。

## D-SHELL-008 — Shell Mode 检测

Shell 模式检测优先级（由高到低）：

1. `VITE_NIMI_SHELL_MODE` 环境变量（`'desktop'` / `'web'`）。
2. Tauri runtime presence 检测（`window.__TAURI_INTERNALS__` / `window.__TAURI_IPC__` 或等价 bridge 环境），不得要求 `window.__TAURI__` 全局暴露。
3. SSR 环境默认 `'desktop'`。

检测结果驱动所有 feature flag 的默认值（`D-SHELL-001` ~ `D-SHELL-003`、`D-BOOT-004`）。

**统一 Feature Flag 派生表**（事实源：`tables/feature-flags.yaml`）：

| Flag | Desktop 默认 | Web 默认 | 控制规则 |
|---|---|---|---|
| `enableRuntimeTab` | `true` | `false` | `D-SHELL-001` |
| `enableModUi` | `true` | `false` | `D-SHELL-002` |
| `enableModWorkspaceTabs` | `true` | `false` | `D-SHELL-002` |
| `enableSettingsExtensions` | `true` | `false` | `D-SHELL-002` |
| `enableTitlebarDrag` | `true` | `false` | `D-SHELL-003` |
| `enableMenuBarShell` | `true`（macOS）/ `false`（其他） | `false` | `D-MBAR-001` |
| `enableRuntimeBootstrap` | `true` | `false` | `D-BOOT-004` |

Web 模式下所有 runtime/mod/window 相关功能默认禁用，仅保留基础 chat/social/explore 功能。此表为 `shellMode → flag` 映射的唯一定义，替代分散在各规则中的零散引用。

## D-SHELL-009 — Mod Developer Mode 入口

Desktop 必须在 App 内提供显式的 Developer Mode 入口，而不是把开发模式建立在启动参数之上：

- Developer Mode 的开启、关闭与状态展示必须位于 App 内可发现位置（例如 Settings / Developer）。
- Developer Mode 负责管理 `dev` source directories、auto reload 开关与开发态诊断入口。
- 第三方 mod 作者使用 Desktop 时，不应被要求通过启动参数或环境变量进入主要开发路径。

## D-SHELL-010 — Mod Source 可观测性与冲突可见性

Desktop UI 必须让用户可观察每个 mod 的解析来源与冲突状态：

- Mods Panel 必须可见 mod 的 source type、来源目录和当前状态（如 `loaded`、`disabled`、`failed`、`conflict`）。
- Developer Panel 必须展示 source directories 列表、每个目录发现的 mod、冲突项、reload 日志与错误链。
- Mod Hub 负责发现、安装、更新与卸载，不应承担主要调试入口；来源路径与冲突排障应在 Mods Panel / Developer Panel 中完成。

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

- baseline surface 的默认落点是 `components/design-tokens.ts`、`components/surface.tsx`、`components/action.tsx`、`components/overlay.tsx` 与 `styles.css` 中的语义 token。
- 受治理的 secondary consumer 必须在 `tables/renderer-design-surfaces.yaml` 中显式登记；`secondary consumer` 不能只存在于 domain prose 或 code review 记忆里。
- feature-local primitive 不得继续作为 `chat`、`contacts`、`runtime-config`、`settings` sidebar family 的事实源；这四个内部左侧栏必须通过共享 sidebar primitive 与对应 fact table 治理。
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

`chat`、`explore`、`contacts` 是 desktop 主设计语言的 baseline anchors：

- 这三个 surface 必须优先消费共享 `surface / action / overlay` primitive。
- baseline 迁移优先级以 root shell、list/card、primary/secondary/icon actions、tooltip 与一个标准 dialog family 为先。
- 新增 baseline 视觉决策必须先在这三个 surface 验证，再扩散到 secondary/admin surface。

## D-SHELL-020 — Controlled Exceptions

`world-detail` 是 desktop renderer 的受控 art-directed exception：

- exception surface 必须在 `tables/renderer-design-surfaces.yaml` 中显式登记，不能只靠实现约定。
- exception 可以使用独立 palette、radius、motion 与视觉编排，但不得把 exception token 或 overlay shell 泄漏到 baseline surface。
- `world-detail` 的例外治理继续受 `D-SHELL-011` ~ `D-SHELL-014` 约束，不得借 design pilot 稀释原有 contract。

## D-SHELL-021 — Arbitrary Value Policy

baseline surface 的 arbitrary Tailwind value 与 inline style 默认禁止：

- `rounded-[...]`、`z-[...]` 与 `style={{...}}` 只有在 `tables/renderer-design-allowlists.yaml` 中登记后才允许保留。
- allowlist 必须带 `scope`、`reason` 与 `source_rule`，用于描述动态几何、受控动画或 renderer bridge 需要的例外。
- allowlist 是过渡治理工具，不等于永久自由区；新增例外必须说明为什么不能落入共享 token / primitive。

## D-SHELL-022 — Primitive Adoption Boundary

baseline surface 的共享 action、surface、dialog、popover 与 tooltip 必须经过 renderer-level primitive facade：

- `chat`、`explore`、`contacts` 中新增或重写的 baseline button / card / dialog / tooltip 不得再定义本地 shell。
- 受治理的 overlay adoption 以 table registration 为准；凡是在 `renderer-design-overlays.yaml` 中登记的 module，必须通过 shared overlay primitive 暴露 dialog / drawer / popover / tooltip shell。
- 允许 feature 组合 shared primitive，但不允许重新发明另一套 baseline shell class contract。
- adoption 进度由 `D-GATE-091` 追踪；完成前允许局部 legacy 实现存在，但不得继续扩散。

## D-SHELL-023 — Sidebar Family Contract

`contacts`、`runtime-config`、`settings` 的 feature 内部左侧栏必须属于同一个 desktop sidebar family。

- 统一 family 固定为 `desktop-sidebar-v1`，事实源为 `tables/renderer-design-sidebars.yaml`。
- 允许的信息架构变体仅限：
  - `contacts`：`header + search + primaryAction + sectioned category/entity list`
  - `runtime-config`：`header + sectioned nav-row list`
  - `settings`：`header + sectioned nav-row list`
- family 必须通过共享 sidebar primitive 暴露一致的 slot：
  - `container`
  - `header`
  - `search?`
  - `primaryAction?`
  - `sectionLabel*`
  - `itemList+`
  - `resizeHandle?`
- `chat` surface 的最外层 contact rail 属于主 shell 级 target rail 组合，不属于本规则范围；该 rail 可以作为 app-owned composition 存在，但不得反向声明自己是 `desktop-sidebar-v1`。

## D-SHELL-024 — Sidebar Item Taxonomy

desktop sidebar family 的 item 语义固定为：

- `entity-row`：头像/实体型列表项，适用于 contact record。
- `category-row`：分类或聚合入口，适用于 contacts 分类与折叠入口。
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
- search、primary action、active row、section label 与 trailing affordance 必须在三个治理内 sidebar 上保持同一家族的一致语义与交互反馈。

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
- `desktop-accent` 继续承担 Desktop identity；accent 不得焊死进
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
  2. baseline route cohort: `home`, `explore`, `contacts`, `notification`,
     `profile`
  3. dense operational cohort: `settings`, `runtime-config`, equivalent admin /
     operations surfaces
  4. chat / agent surfaces only after a separate admitted decision packet
- 在上述顺序被新的 admitted wave 明确改写前，任何实现波都不得跳过 shell frame
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
  decision surface，必须在后续 wave 里显式决定。
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
- `contacts` / `profile` 的 branded hero-glass 族谱在单独 decision packet 闭环前，
  只允许作为 `secondary` surface 注册为 exception candidate，不得直接提升成
  admitted exception。
- `world-detail` 继续是当前唯一受控的 Desktop art-directed exception；任何其他
  route-local card 只有在后续 admitted wave 明确授权时，才允许升级为 exception。
- route-local secondary / tertiary card cluster 必须在
  `tables/renderer-design-surfaces.yaml` 中显式登记；只登记 route root 不足以表达
  inner-card hierarchy。
- 本轮 authority cut 冻结的实现 cohort 顺序固定如下：
  1. `chat` secondary card cluster + shared `settings` / `runtime-config`
     operational card wrapper
  2. `home` / `explore` / `notification` inner-card convergence
  3. `contacts` / `profile` branded card decision packet
- 在上述 cohort 被新的 admitted wave 改写前，Desktop 不得把 leaf card restyle
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
  `chat`-owned exception candidate 登记，不得被默认为 shared card：
  1. canonical transcript / stage conversation chrome
  2. avatar/stage viewport chrome（包含 Live2D / VRM renderer chrome）
  3. 与 avatar presentation 强绑定的 presence / status chrome
- `chat` exception candidate 不是自动 admitted exception。只有在
  `tables/renderer-design-surfaces.yaml` 中被显式登记并在后续 wave 中明确保留时，
  才允许继续使用 bespoke geometry、gradient、orbital chrome 或 renderer-local
  presentation recipe。
- `chat` secondary / tertiary surface cluster 必须在
  `tables/renderer-design-surfaces.yaml` 中显式登记为 converging cohort 或
  exception candidate；只登记 `chat.page.root` 与 `chat.secondary.cards`
  不足以表达当前边界。
- 本轮 authority cut 冻结的实现顺序固定如下：
  1. `chat-page` floating controls + right-panel utility/settings rail controls
  2. session/history/target-selector/inspect/diagnostics cards
  3. canonical conversation chrome + avatar/stage viewport chrome 的单独
     exception decision packet
- 在上述边界被新的 admitted wave 改写前，Desktop 不得把 `chat` 的 leaf restyle
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
- 先前的 `chat` avatar viewport chrome（Live2D / VRM）controlled exception 已在
  Wave 4 Exec Pack 4 退役；desktop 不再把本地 avatar viewport/render chrome
  作为当前 shell exception line。
- Pack 4 之后，desktop 在该 area 只保留：
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

## D-SHELL-032 — Contacts Profile Branded Surface Split And Hero Exception Freeze

`contacts` / `profile` 不再允许被当成一整块 branded subsystem。W1 decision packet
必须把 shell-root、hero shell、feed cards 三类 surface 拆开治理。

- `contacts.view.root` 与 `profile.panel.root` 继续是 Desktop shared shell root
  consumer，不得因为 detail hero shell 仍然品牌化，就整体回退成
  `contacts/profile`-owned art direction。
- `contacts` profile detail hero shell 现被限定为一组窄范围 controlled exception，
  仅覆盖：
  1. detail hero header / backdrop aura
  2. detail hero glass slab 与 companion skeleton / loading / error shell
  3. 与 detail hero shell 强绑定的 branded stats/action chrome
- 上述 `contacts` hero exception 不自动扩展到：
  1. `contacts` friend request / relationship cards
  2. `profile` feed cards
  3. generic overlay / dialog surfaces
  4. sidebar rows、category rows、search rows
- `profile` tab content cards（posts / likes / collections / media / gifts）与
  `contacts` friend request cards 必须被视为 converging cohort，而不是 hero
  exception 的自然延伸。它们后续只能通过 admitted Desktop shared card/action
  path 收敛，不得继续维持 branded white-card / mint-accent local family。
- `contacts/profile` branded mint accent、arbitrary radius、white-card shadow
  formula，不得再被表述成“profile 特例”。只有在
  `renderer-design-surfaces.yaml` 中被显式登记为 exception 的 detail hero shell
  才允许保留 bespoke geometry 与 glass aura。
- `tables/renderer-design-surfaces.yaml` 必须把本轮 disposition 显式记录为：
  1. `contacts.profile_detail.hero_exception`
  2. `contacts.profile_detail.shell_exception`
  3. `contacts.friend_requests.cards`
  4. `profile.posts.cards`
  5. `profile.likes.cards`
  6. `profile.collections.cards`
  7. `profile.media.cards`
  8. `profile.gifts.cards`

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

## Fact Sources

- `tables/app-tabs.yaml` — 导航 Tab 枚举
- `tables/feature-flags.yaml` — Feature flag 定义
- `tables/build-chunks.yaml` — Vite 分包枚举
- `tables/renderer-design-tokens.yaml` — baseline semantic design token
- `tables/renderer-design-surfaces.yaml` — baseline / secondary / exception surface mapping
- `tables/renderer-design-sidebars.yaml` — governed desktop sidebar family mapping
- `tables/renderer-design-overlays.yaml` — shared overlay taxonomy
- `tables/renderer-design-allowlists.yaml` — arbitrary value / inline style allowlists
- `menu-bar-shell-contract.md` — macOS menu bar shell 入口
- `agent-avatar-surface-contract.md` — avatar projection consume boundary for shell-owned attention
