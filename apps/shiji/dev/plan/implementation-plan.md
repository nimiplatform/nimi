# 时迹 (ShiJi) — Implementation Plan

> Status: Draft | Date: 2026-04-01
> Source: `spec/` kernel contracts + YAML tables
> Pattern Reference: `apps/desktop/` Tauri app architecture

---

## Overview

本计划覆盖时迹从零到可交付产品的四个阶段。阶段划分对齐 `feature-matrix.yaml` 的 phase 分层；阶段内的 step 顺序按实现依赖链排列（先基础设施后上层功能），不严格等于 feature-matrix 的 priority 排序。每个实现步骤标注对应的 spec 规则 ID，确保实现与设计的可追溯性。

时迹复用 nimi desktop app 的 Tauri + React + SDK 架构模式，但不实现 mod 系统、realtime sync、3D 渲染等 desktop 特有功能。时迹独有的能力集中在对话引擎、知识脚手架和教育数据追踪。

---

## Hard Principles（贯穿全项目的硬性原则）

### Greenfield: No Legacy

时迹是一个从零开始的全新项目。绝不引入以下内容：

- **No legacy shims** — 不为"兼容旧代码"添加任何 wrapper、adapter、shim、或 polyfill
- **No deprecated patterns** — 不使用任何已在 nimi 生态中标记为 deprecated 的 API、组件、或模式（如 `realm.raw.request`、`realm.unsafeRaw.request`）
- **No compatibility layers** — 不添加 feature flags、环境分支、或"旧模式/新模式"切换。每个功能只有一种实现方式
- **No copy-paste from desktop** — 参考 desktop app 的架构模式，但不直接复制其代码。时迹的每一行代码都为教育场景设计
- **No provisional stubs** — 不为尚未实现的后端端点创建 fake success stubs 或 mock fallback。`api-surface.yaml` 中 `status: proposed` 的端点在实现前不可调用

### Fail-Close: 不隐藏错误

所有层级遵循 fail-close 原则——宁可向用户显示明确错误，也不返回伪成功：

| 层级 | Fail-Close 行为 |
|------|----------------|
| **Explore** | Realm API 失败 → 显示 retriable error，不回退缓存（SJ-EXPL-001:5）。分类配对无效 → 排除该 world（SJ-EXPL-010）|
| **Dialogue Entry** | 缺少 learner profile → 阻断对话入口（SJ-SHELL-008）。缺少 classification metadata → 阻断对话入口（SJ-DIAL-014:3）|
| **Prompt Builder** | token budget 装不下最小 block 集 → fail-close with actionable error，不静默降级 prompt（SJ-DIAL-003）|
| **Choice Parser** | crisis 场景解析失败 + retry 失败 → fail-close with retriable error，不降级为叙事（SJ-DIAL-005:4）|
| **Map** | 缺 profile / 缺字段 / disabled → 阻断渲染，不伪造地理数据（SJ-MAP-005）|
| **SQLite** | Schema migration 失败 → 阻断 app 启动，不在损坏的 schema 上运行查询 |
| **Bridge IPC** | Tauri invoke 返回非预期格式 → 抛出 typed error，不 coerce 成默认值 |
| **Session Classification** | session snapshot 的 contentType/truthMode 被篡改或丢失 → 阻断 session resume，不猜测分类 |

**禁止的模式**：
- 返回空数组当作"无数据"来掩盖 API 错误
- 用 `try-catch` 吞掉错误然后返回 default value
- 在 MIME type、schema、contract 解码失败时 retry（retry 只适用于 transient transport failures）
- 用 `console.warn` 记录错误但继续走 happy path

### UI First from Kit: 优先使用 nimi-kit

时迹必须优先使用 `@nimiplatform/nimi-kit` 提供的 UI 基础设施。只有 kit 确实不覆盖的教育特有场景才允许 app 自建。

#### 必须从 kit 使用的模块

| kit 模块 | 时迹用途 | 对应 spec |
|----------|---------|-----------|
| `@nimiplatform/nimi-kit/ui` | 全部 UI primitives：Button, Input, Dialog, Card, Toast, Badge, Tooltip, ScrollArea 等 | 全局 |
| `@nimiplatform/nimi-kit/ui/styles.css` | 基础样式 | 全局 |
| `@nimiplatform/nimi-kit/ui/themes/light.css` | 主题（时迹只用 light mode，面向儿童） | SJ-SHELL-004 |
| `@nimiplatform/nimi-kit/core/oauth` | OAuth 登录流 | SJ-SHELL-002 |
| `@nimiplatform/nimi-kit/core/shell-mode` | Shell capability helpers | SJ-SHELL-001 |
| `@nimiplatform/nimi-kit/telemetry/error-boundary` | `ShellErrorBoundary` 包裹 content area | SJ-SHELL-003:4 |
| `@nimiplatform/nimi-kit/auth` | 认证 UI 组件 + 登录页 | SJ-SHELL-002 |
| `@nimiplatform/nimi-kit/auth/native-oauth-result-page` | OAuth 回调页 | SJ-SHELL-002 |
| `@nimiplatform/nimi-kit/features/model-picker/ui` | AI 模型选择器 UI | SJ-SHELL-005:1 |
| `@nimiplatform/nimi-kit/features/model-picker/runtime` | 模型列表 + 选择逻辑 | SJ-SHELL-005:1 |

#### 时迹需要 app 自建的组件（kit 不覆盖）

| 组件 | 原因 |
|------|------|
| 时间线 (`Timeline`) | 教育产品特有的横向历史时间河，kit 无此 surface |
| 人物邂逅卡片 (`CharacterEncounterCard`) | 首次体验的沉浸式角色对话卡，教育产品特有 |
| 叙事过渡 overlay (`TransitionOverlay`) | 时间线朝代间的叙事文字浮层 |
| 对话叙事显示 (`NarrativeDisplay`) | 流式 token 渲染 + 历史日期 + 中断指示器，不是通用 chat |
| 选项面板 (`ChoicePanel`) | A/B 历史抉择 UI，不是通用 chat action |
| 知识图谱 (`KnowledgeGraph`) | 分层概念可视化，教育特有 |
| 进度统计 (`ProgressDashboard`) | 学习统计卡片，教育特有 |
| 成就 toast (`AchievementToast`) | 勋章解锁通知样式 |
| Parent Mode PIN gate | PIN 输入 + 家长模式入口 |
| Profile Editor | 学习者画像编辑表单 |

**自建组件的规则**：
- 基础元素（Button, Input, Card, Dialog, Badge, ScrollArea, Toast 等）必须从 `nimi-kit/ui` 取，不可 app 内重写
- 自建组件内部组合 kit primitives，不从零搭建
- 样式基于 `nimi-kit/ui/styles.css` + light theme，额外样式用 Tailwind 扩展
- 不为时迹创建独立 accent theme（Phase 0 不需要，后续如需要则提 kit PR）

---

## Phase 0: Project Scaffold（脚手架搭建）

> 目标：建立可运行的空 Tauri app，确认工具链和依赖就绪

### 0.1 — 项目文件创建

| 文件 | 用途 | 参考 |
|------|------|------|
| `package.json` | 包注册 `@nimiplatform/shiji`，scripts，依赖声明 | desktop `package.json` |
| `vite.config.ts` | Vite 7，root = `src/shell/renderer`，port 1425 | desktop `vite.config.ts` |
| `tsconfig.json` | strict mode，path aliases `@renderer/*` `@engine/*` | desktop `tsconfig.json` |
| `src-tauri/tauri.conf.json` | identifier `app.nimi.shiji`，dev URL `127.0.0.1:1425` | desktop `tauri.conf.json` |
| `src-tauri/Cargo.toml` | tauri 2 + rusqlite + tokio | desktop `Cargo.toml` |
| `src-tauri/src/lib.rs` | Tauri builder entry | desktop `main.rs` |

### 0.2 — 目录结构

```
apps/shiji/
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                       # Tauri shell entry
│   │   ├── app_bootstrap.rs             # Tauri builder, plugin registration
│   │   ├── runtime_bridge/              # IPC command handlers
│   │   │   ├── mod.rs
│   │   │   ├── invoke.rs                # Typed invoke helper
│   │   │   └── oauth.rs                 # OAuth bridge
│   │   └── sqlite/                      # SQLite schema + migrations
│   │       ├── mod.rs
│   │       ├── migrations.rs            # Schema versioning
│   │       └── queries.rs               # Typed query wrappers
│   ├── tauri.conf.json
│   └── Cargo.toml
├── src/
│   └── shell/
│       └── renderer/                    # Vite root
│           ├── index.html
│           ├── main.tsx                 # App entry
│           ├── App.tsx                  # Bootstrap orchestrator
│           ├── app-shell/
│           │   ├── providers.tsx        # Provider stack
│           │   ├── app-store.ts         # Zustand root store
│           │   ├── routes.tsx           # Route definitions
│           │   ├── shell-layout.tsx     # Side nav + content area
│           │   ├── login-gate.tsx       # Auth gate
│           │   └── bootstrap.ts         # SDK + auth + runtime boot
│           ├── bridge/
│           │   ├── index.ts             # Bridge exports
│           │   ├── invoke.ts            # Typed Tauri invoke wrapper
│           │   ├── oauth-bridge.ts      # OAuth IPC
│           │   └── sqlite-bridge.ts     # SQLite IPC
│           ├── data/                    # Realm API data clients
│           │   ├── world-client.ts      # World discovery queries
│           │   ├── agent-client.ts      # Agent queries
│           │   ├── content-client.ts    # Rules, lorebooks, events, scenes
│           │   ├── memory-client.ts     # Agent memory
│           │   └── binding-client.ts    # Asset bindings
│           ├── engine/                  # Dialogue engine (core)
│           │   ├── dialogue-pipeline.ts
│           │   ├── context-assembler.ts
│           │   ├── prompt-builder.ts
│           │   ├── choice-parser.ts
│           │   ├── pacing-enforcer.ts
│           │   ├── trunk-convergence.ts
│           │   ├── knowledge-scaffolder.ts
│           │   ├── lorebook-matcher.ts
│           │   ├── explanation-detector.ts
│           │   ├── temporal-tracker.ts
│           │   └── types.ts
│           ├── state/                   # Zustand store slices
│           │   ├── auth-slice.ts
│           │   ├── session-slice.ts
│           │   ├── profile-slice.ts
│           │   └── ui-slice.ts
│           ├── features/
│           │   ├── explore/             # Explore pages
│           │   ├── session/             # Dialogue session page
│           │   ├── knowledge/           # Knowledge graph pages
│           │   ├── progress/            # Progress pages
│           │   └── settings/            # Settings + parent mode
│           ├── hooks/                   # Shared React hooks
│           ├── components/              # Shared UI components
│           ├── locales/                 # i18n JSON
│           │   ├── zh.json
│           │   └── en.json
│           └── i18n/
│               └── index.ts            # i18next setup
├── spec/                               # Already exists
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### 0.3 — 依赖清单

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@tauri-apps/api` | ^2 | Tauri core IPC |
| `@tauri-apps/plugin-*` | ^2 | deep-link, updater |
| `react` + `react-dom` | ^19 | UI framework |
| `react-router-dom` | ^7 | HashRouter SPA routing |
| `zustand` | ^5 | Global state |
| `@tanstack/react-query` | ^5 | Data fetching + caching |
| `i18next` + `react-i18next` | latest | 国际化 |
| `tailwindcss` | ^4 | 样式 |
| `@nimiplatform/sdk` | workspace:* | Runtime + Realm client |
| `@nimiplatform/nimi-kit` | workspace:* | UI 组件 + OAuth |

### 0.4 — 验收标准

- `pnpm --filter @nimiplatform/shiji dev:renderer` 启动 Vite dev server on port 1425
- `pnpm --filter @nimiplatform/shiji dev:shell` 启动 Tauri 窗口显示空白 React app
- `pnpm --filter @nimiplatform/shiji typecheck` 通过
- `pnpm --filter @nimiplatform/shiji build` 成功

---

## Phase 1: Core（核心产品循环）

> 目标：完成从"打开 App → 浏览时间线 → 选人物 → 对话 → 学到知识"的完整循环

### Step 1.1 — App Shell + Bootstrap + Auth + Character Encounter

**对应规则**: SJ-SHELL-001 ~ 004, SJ-SHELL-008 ~ 009

**实现内容**:

| 模块 | 文件 | 说明 |
|------|------|------|
| Bootstrap | `app-shell/bootstrap.ts` | `runShiJiBootstrap()` → Tauri bridge defaults → `createPlatformClient({ appId: 'nimi.shiji' })` → auth session → 并行发起 runtime readiness 检查（非阻塞）。超过 15s 仅记录状态并进入 cloud-only mode，不阻塞 routes render（per SJ-SHELL-001:5-6）|
| Auth | `app-shell/login-gate.tsx` | 复用 `@nimiplatform/nimi-kit/core/oauth`。未认证 → login gate。Token persist via Tauri secure storage。刷新走 SDK `sessionStore` callback |
| Shell Layout | `app-shell/shell-layout.tsx` | 侧边栏 icon bar（Explore/Knowledge/Progress/Settings）+ content area。对话模式隐藏侧栏进入全屏 |
| Age Defaults | `app-shell/bootstrap.ts` | Content rating = G，NSFW 永久关闭，font 16px，timer 默认 45 分钟 |
| Onboarding Gate | `features/explore/onboarding-gate.ts` | Hook：`useOnboardingGate()` 在"开始对话"按钮处检查 active profile 是否存在，无则跳转 parent mode profile 创建 |
| Providers | `app-shell/providers.tsx` | `I18nextProvider → QueryClientProvider(staleTime: 15s, retry: 1) → TooltipProvider → HashRouter → Children` |
| Store | `app-shell/app-store.ts` | Zustand sliced: `createAuthSlice` + `createSessionSlice` + `createProfileSlice` + `createUiSlice` |
| Routes | `app-shell/routes.tsx` | 按 `routes.yaml` 定义全部路由，lazy load。`/` redirect to `/explore` |
| Encounter UI (展示层) | `features/explore/character-encounter.tsx` | 纯前端 overlay：人物以困境开口 + 预览标签 + "好"/"换一个人"，最多 3 个人物，零学习成本（per SJ-SHELL-009:2-3,5,9）。**此层不依赖 SQLite**，在 Step 1.2 之前 encounter 对所有用户展示 |
| Encounter Scripts | `data/encounter-scripts.ts` | 预写固定脚本，每条绑定 `world-catalog.yaml` 的 `primaryAgentIds`（per SJ-SHELL-009:7）。包含：开场困境台词、预览标签（朝代+主题方向）、对应 agentId + worldId |
| Encounter Persistence (持久化层) | `features/explore/character-encounter.tsx` | **依赖 Step 1.2 SQLite**。SQLite 就绪后启用完整触发逻辑（per SJ-SHELL-009:8a-d）：读取 `learner_profiles.encounterCompletedAt` 判定是否展示；完成后写入时间戳。SQLite 未就绪时降级为始终展示（等效于首次访问语义）|

### Step 1.2 — SQLite Schema + Migrations

**对应规则**: `local-storage.yaml` 全部 8 张表

> **这是后续所有本地数据功能的前置依赖。** Step 1.3 (Settings/Profile) 和 Step 1.5 (Dialogue) 都依赖此处创建的表，因此必须先于二者实现。

**实现内容**:

| 模块 | 文件 | 说明 |
|------|------|------|
| Schema | `src-tauri/src/sqlite/migrations.rs` | 创建 8 张表：`sessions`, `dialogue_turns`, `choices`, `knowledge_entries`, `learner_profiles`, `learner_context_notes`, `chapter_progress`, `achievements` |
| IPC | `src-tauri/src/sqlite/queries.rs` | 为每张表提供 CRUD Tauri commands |
| Bridge | `bridge/sqlite-bridge.ts` | TypeScript 端 typed invoke wrappers，按表分 namespace |
| Version | migration v1 | 初始 schema。后续变更通过版本号递增 |

**列定义严格对应 `local-storage.yaml` 的 `required_columns`、`json_columns`、`indexes`。**

### Step 1.3 — Settings + Learner Profile + Parent Mode

**对应规则**: SJ-SHELL-005 ~ 007

**依赖**: Step 1.2 (SQLite tables: `learner_profiles`, `learner_context_notes`)

**实现内容**:

| 模块 | 文件 | 说明 |
|------|------|------|
| Settings Page | `features/settings/settings-page.tsx` | AI 模型选择（复用 `nimi-kit/features/model-picker`）、TTS 开关、STT 开关、计时器、Parent Mode 入口 |
| Parent Mode | `features/settings/parent-mode.tsx` | PIN 输入 gate → profile 管理、adaptation notes 查看、report 入口 |
| Profile Editor | `features/settings/profile-editor.tsx` | 创建/编辑 learner profile。字段：displayName, age, communicationStyle, strengthTags, interestTags, supportNotes, guardianGuidance, guardianGoals。创建时如 encounter 已完成（per SJ-SHELL-009:8d），写入 `encounterCompletedAt` |
| Profile Switcher | `features/settings/profile-switcher.tsx` | 多 profile 列表，切换 active（per SJ-SHELL-006:5-7）|
| Profile Versioning | `state/profile-slice.ts` | 编辑触发 `profileVersion++`，session 创建时 snapshot version（per SJ-SHELL-007）|

### Step 1.4 — Explore: Timeline + World Detail + Agent Detail

**对应规则**: SJ-EXPL-001 ~ 009, SJ-EXPL-010 ~ 012

**实现内容**:

| 模块 | 文件 | 说明 |
|------|------|------|
| World Client | `data/world-client.ts` | TanStack Query hooks：`useWorldList()`, `useWorldDetail(worldId)`, `useWorldDetailWithAgents(worldId)` |
| Catalog | `data/catalog.ts` | 加载 `world-catalog.yaml`（打包为 JSON），与 API 结果 intersect，按 `sortOrder` 排序。校验 `contentType`+`truthMode` 配对（SJ-EXPL-010）|
| Timeline | `features/explore/timeline.tsx` | 横向可滚动时间河，左古右今。节点显示 banner thumb + 名称 + 年代 + 分类 badge。已探索彩色/未探索灰色。键盘左右导航 |
| Narrative Transitions | `features/explore/timeline-transition.tsx` | 相邻朝代间的叙事过渡文字，首次出现后不再重复（SJ-EXPL-011）|
| Search + Filter | `features/explore/explore-filters.tsx` | 文本搜索（名称/年代/tagline）+ contentType 筛选 + truthMode 筛选 + 探索状态筛选 |
| World Detail | `features/explore/world-detail-page.tsx` | Hero banner + 描述 + 分类 badge + 推荐 Agent 卡片 + 更多 Agent 折叠区 |
| Agent Card | `features/explore/agent-card.tsx` | 头像 + 名称 + 角色 + 简介 + 视角提示（SJ-EXPL-012:2）|
| Multi-Perspective | `features/explore/replay-prompt.tsx` | 完成 session 后提示"换个视角再看这段历史"（SJ-EXPL-012:3）|
| Agent Detail | `features/explore/agent-detail-page.tsx` | 人物肖像 + DNA summary + 世界分类 badge + "开始对话"/"继续对话" 按钮 |
| API Failure | `features/explore/explore-error.tsx` | Realm API 失败 → retriable error，不回退到缓存（SJ-EXPL-001:5）|

**Realm APIs**: `GET /api/world`, `GET /api/world/by-id/{worldId}/detail-with-agents`, `GET /api/world/by-id/{worldId}/agents`, `GET /api/agent/accounts/{agentId}`, `GET /api/world/by-id/{worldId}/bindings`

### Step 1.5 — Dialogue Engine

**对应规则**: SJ-DIAL-001 ~ 009, SJ-DIAL-013 ~ 019

这是时迹最核心的模块。所有逻辑集中在 `engine/` 目录。

#### 1.5.1 — Pipeline 骨架

| 文件 | 职责 | 规则 |
|------|------|------|
| `dialogue-pipeline.ts` | 管线编排：Input → Assembly → Build → Generate → PostProcess → Render。每步 typed I/O，失败 surface actionable error | SJ-DIAL-001 |
| `types.ts` | 全部 engine 类型定义：`SceneType`, `PipelineContext`, `AssembledContext`, `PromptBlocks`, `ParsedChoice`, `PacingState`, `TrunkState` | — |

#### 1.5.2 — Context Assembly

| 文件 | 职责 | 规则 |
|------|------|------|
| `context-assembler.ts` | 聚合 10 个数据源：catalog metadata, learner profile, adaptation notes, WorldRules, AgentRules, lorebooks, trunk events, agent memory, session state, dialogue history | SJ-DIAL-002 |

- Realm 数据 TTL 缓存：WorldRules/AgentRules/Lorebooks 15 分钟，trunk events 30 分钟
- 本地数据（session, history, knowledge）每次新鲜读取
- Session 的 `contentType`/`truthMode` 来自创建时 snapshot，不做 live re-read

**Context Assembly 消费的全部 Realm API**:

| 端点 | 数据源编号 | 用途 |
|------|-----------|------|
| `GET /api/world/by-id/{worldId}/rules` | #4 WorldRules | 叙事治理规则 |
| `GET /api/world/by-id/{worldId}/agent-rules` | #5 AgentRules | 人物行为边界 |
| `GET /api/world/by-id/{worldId}/lorebooks` | #6 Lorebooks | 历史知识条目 |
| `GET /api/world/by-id/{worldId}/events` | #7 Trunk events | 主干锁定历史事件 |
| `GET /api/world/by-id/{worldId}/scenes` | (location/setting metadata) | 场景地点元数据，提供给 World context block |
| `GET /api/agent/{agentId}/memory/recall` | #8 Agent memory | DYADIC 跨 session 关系记忆 |

**Session 生命周期消费的 Realm API**:

| 端点 | 触发时机 | 用途 |
|------|---------|------|
| `POST /api/agent/{agentId}/memory/write` | Session pause/complete | 写入 DYADIC 记忆：对话摘要、关系里程碑、承诺。由 dialogue engine 在 session 暂停或完成时自动触发（per SJ-DIAL-002 Assembly source 8 clarification）|

#### 1.5.3 — Prompt Builder

| 文件 | 职责 | 规则 |
|------|------|------|
| `prompt-builder.ts` | 组装 13 个 block 的 system prompt。固定优先级顺序。预算超限按规定顺序 trim。priority 1-6 为最小集不可删除。fit 不下 → fail-close | SJ-DIAL-003 |

**13 个 Block（定义编号，与 SJ-DIAL-003 kernel 合同完全一致）**:

| Block # | 名称 | 来源 | Trim Priority |
|---------|------|------|---------------|
| 1 | Identity | AgentRules：人物身份、哲学、口吻 | 2（不可删除）|
| 2 | Relationship | AgentRules：与学生的关系（辅助者/参谋定位 per SJ-DIAL-003:2） | 7 |
| 3 | World context | WorldRules：时代、政制、约束 | 8 |
| 4 | Classification | Session snapshot：contentType + truthMode + 真值边界 | 1（不可删除）|
| 5 | Learner profile | Guardian-entered profile：年龄、兴趣、能力、沟通风格 | 3（不可删除）|
| 6 | Adaptation | Approved local notes：比喻体系、简洁性偏好、节奏敏感度 | 6（不可删除）|
| 7 | Narrative governance | WorldRules：节奏、选项格式、知识脚手架规则 | 4（不可删除）|
| 8 | Scene directive | Local state：当前 scene type + 场景指令（含轻量互动 per SJ-DIAL-018）| 5（不可删除）|
| 9 | Knowledge state | Local SQLite：已学/可讲概念 | 10 |
| 10 | Trunk horizon | Trunk events + local index：下一主干事件 + 远近评估 | 9 |
| 11 | Lorebook injection | Keyword-matched entries（per SJ-DIAL-017）| 13（最先被 trim）|
| 12 | Memory snippets | DYADIC memory entries | 12 |
| 13 | Recent dialogue | 最近 N 轮对话历史 | 11 |

> **重要**：Block 编号是定义顺序（SJ-DIAL-003 clauses 1-13），Trim Priority 是预算裁剪优先级（SJ-DIAL-003 priority list 1-13）。两套编号不可混淆。SJ-DIAL-017 引用的"SJ-DIAL-003 block 11"指的是定义编号 11 即 Lorebook injection。

#### 1.5.4 — AI Generation

| 文件 | 职责 | 规则 |
|------|------|------|
| `dialogue-pipeline.ts` (generate step) | 调用 `runtime.ai.text.generate()` streaming。传输失败 retry 1 次。用户可取消。中断 → partial output + "中断" 指示器 + retry 按钮 | SJ-DIAL-004 |

#### 1.5.5 — Post-Processing Modules

| 文件 | 职责 | 规则 |
|------|------|------|
| `choice-parser.ts` | 解析 A/B 选项。crisis 场景解析失败 → retry 1 次 → 仍失败 fail-close。非 crisis → 降级为叙事 | SJ-DIAL-005 |
| `pacing-enforcer.ts` | 节奏管理：rhythm counter（crisis++, campfire reset）、campfire 触发（阈值 3）、verification 触发（每 5 轮 + 章节边界）、metacognition 触发（trunk 到达）。Scene type 是 app 层枚举，非 Realm 来源 | SJ-DIAL-006 |
| `trunk-convergence.ts` | 主干收敛：event list + current index。远 → freedom directive，近 → convergence directive。到达 → advance index + chapter progress。不强制，通过角色对话引导 | SJ-DIAL-007 |
| `lorebook-matcher.ts` | 关键词精确匹配，上下文窗口 10 轮，最多注入 5 条，最近用户输入优先 | SJ-DIAL-017 |
| `knowledge-scaffolder.ts` | 知识状态 block：depth≥1 标记"已理解"，depth 0 标记"可讲解"，新概念≤3/turn。发现式学习原则 | SJ-KNOW-002 |
| `explanation-detector.ts` | 扫描 AI 输出的概念关键词 + 解释指标，depth 0 → 1 升级。保守检测（允许漏检不允许误检）| SJ-KNOW-003 |
| `temporal-tracker.ts` | 从 trunk event metadata 初始化历史日期，trunk 到达更新，AI 输出中检测时间推进线索 | SJ-DIAL-019 |

#### 1.5.6 — Session Management

| 文件 | 职责 | 规则 |
|------|------|------|
| `state/session-slice.ts` | Session CRUD：Create（snapshot contentType/truthMode/profileVersion）、Resume、Pause（auto-save）、Complete、Restart（旧 session → ABANDONED，知识保留）| SJ-DIAL-008 |
| `bridge/sqlite-bridge.ts` | Dialogue turns + choices persist per turn | SJ-DIAL-009 |
| `data/memory-client.ts` | Session pause/complete 时调用 `POST /api/agent/{agentId}/memory/write` 写入 DYADIC 记忆（对话摘要、关系里程碑）。写入内容由 engine 从 session 上下文生成 | SJ-DIAL-002 (source 8) |
| `data/content-client.ts` | `GET /api/world/by-id/{worldId}/scenes` 读取场景地点/设定元数据，提供给 context assembly 的 World context block | SJ-DIAL-002 |

#### 1.5.7 — Classification + Truth Boundary

| 文件 | 职责 | 规则 |
|------|------|------|
| `prompt-builder.ts` (block 4) | Classification injection：session snapshot contentType + truthMode + 真值边界约束 | SJ-DIAL-013 |
| `prompt-builder.ts` (block 4 ext) | 非 canonical world → 教为"复述/传说/象征"，不教为 canonical 历史。缺分类 → 阻断对话入口 | SJ-DIAL-014 |

#### 1.5.8 — Learner Adaptation

| 文件 | 职责 | 规则 |
|------|------|------|
| `prompt-builder.ts` (block 5) | Profile injection：age, interests, strengths, communication style, goals | SJ-DIAL-015 |
| `prompt-builder.ts` (block 6) | Adaptation notes injection：偏好的比喻体系、简洁性偏好、节奏敏感度 | SJ-DIAL-016 |

#### 1.5.9 — Dialogue UI

| 文件 | 职责 | 规则 |
|------|------|------|
| `features/session/dialogue-session-page.tsx` | 全屏沉浸对话页。隐藏侧栏。顶部显示人物名 + 世界分类 badge + 历史日期（SJ-DIAL-019）|
| `features/session/narrative-display.tsx` | 流式 token 渲染，支持 partial output + 中断指示器 |
| `features/session/choice-panel.tsx` | A/B 选项面板（crisis 场景）|
| `features/session/input-area.tsx` | 文本输入 + 发送按钮 + 取消生成按钮 |
| `features/session/temporal-display.tsx` | 历史日期持久显示组件：年号 + 月日 / 公元年 |

### Step 1.6 — Knowledge Tracking（Phase 1 核心部分）

**对应规则**: SJ-KNOW-001, SJ-KNOW-003 ~ 004

Phase 1 实现知识追踪的写入侧（对话中记录知识），Phase 2 实现展示侧（知识图谱页面）。

| 模块 | 文件 | 说明 |
|------|------|------|
| Tracking Model | `engine/knowledge-scaffolder.ts` | 管理 `concept_key` + `domain` + `depth(0/1/2)`。scope = learner + world |
| Explanation Detection | `engine/explanation-detector.ts` | AI 输出后扫描，depth 0→1 升级 |
| Verification Questions | `engine/pacing-enforcer.ts` + `prompt-builder.ts` | 章节边界 + 每 5 轮触发 verification scene → prompt 指示 agent 出填空题 → 评估 → depth 1→2 |

**SQLite 表**: `knowledge_entries`

### Phase 1 前置数据门槛

> 以下数据条件必须在验收前满足。如果缺失，对应验收项不可执行。

| 门槛 | 数据文件 | 最低要求 |
|------|---------|---------|
| **Catalog 有效条目** | `world-catalog.yaml` | `entries` 中至少 3 个 `status: ACTIVE` 的 world，且 contentType/truthMode 为合法配对 |
| **primaryAgentIds 已填** | `world-catalog.yaml` | 每个 ACTIVE world 至少 1 个 primaryAgentId 指向已存在的 Realm agent |
| **Character Encounter 脚本** | `data/encounter-scripts.ts` | 至少 3 条预写脚本，绑定到 catalog 中 ACTIVE world 的 primaryAgentIds |
| **Timeline Transition 文本** | catalog 或独立数据 | 至少 2 对相邻朝代的过渡叙事文字（可选，缺失不阻塞 timeline 本身） |
| **Realm 内容就绪** | Realm API | 被 catalog 引用的 worldId 必须在 Realm 中存在对应的 World + Agents + Rules + Lorebooks + Events |

### Phase 1 验收标准

- [ ] 打开 App → 登录 → 看到时间线
- [ ] 首次用户看到人物邂逅 overlay，可接受/换人/跳过
- [ ] 时间线显示 catalog 中 ACTIVE worlds，分类 badge 正确
- [ ] 点击 World → 详情页 → Agent 卡片 → Agent 详情
- [ ] 无 profile 时"开始对话"→ 引导创建 profile
- [ ] 有 profile → 创建 session（snapshot classification + profile version）→ 进入全屏对话
- [ ] 对话流式生成，crisis 场景有 A/B 选项，campfire 有轻量互动
- [ ] 历史日期随叙事推进变化
- [ ] 知识 depth 随对话正确追踪（0→1→2）
- [ ] Session pause/complete 时 DYADIC memory 写回 Realm
- [ ] Session pause/resume/restart 工作正常
- [ ] 设置页：AI 模型选择、计时器、Parent mode PIN

---

## Phase 2: Education（教育深度）

> 目标：知识可视化、学习进度追踪、成就系统、地图

### Step 2.1 — Knowledge Graph + World Knowledge Detail

**对应规则**: SJ-KNOW-005 ~ 008

| 模块 | 文件 | 说明 |
|------|------|------|
| Graph Page | `features/knowledge/knowledge-graph-page.tsx` | World → Domain → Concept 三级分组。depth 色标（grey/blue/gold）。统计面板 |
| World Detail | `features/knowledge/knowledge-world-page.tsx` | 单 World 内按 domain 分组，per-domain depth 分布。depth 2 显示验证问答（SJ-KNOW-008）|
| Cross-World | `features/knowledge/cross-world-links.tsx` | 同一 concept_key 跨 world 虚线连接。一处学习 → 他处 depth 0 awareness（SJ-KNOW-006）|
| Provenance | components | 分类标签（SJ-KNOW-007）：canonical 与 non-canonical 知识分开展示 |

### Step 2.2 — Progress Overview + Achievements

**对应规则**: SJ-PROG-001 ~ 004, SJ-PROG-006 ~ 007

| 模块 | 文件 | 说明 |
|------|------|------|
| Progress Page | `features/progress/progress-overview-page.tsx` | Summary cards（hours/worlds/concepts/verification%）+ World progress grid + 最近 sessions + 时间线视图。按 contentType 分类统计（SJ-PROG-006）。per-world agent 覆盖率（SJ-EXPL-012:4）|
| Achievements | `features/progress/achievements-page.tsx` | 探索/知识/对话/特殊成就。硬编码定义。Toast 通知 |
| Learner Context Review | `features/settings/parent-mode.tsx` (extension) | Guardian 查看/编辑 profile + adaptation notes（SJ-PROG-007）|

### Step 2.3 — Explore Atlas（历史地图）

**对应规则**: SJ-MAP-001 ~ 005

> **阻塞项**: `GET /api/world/by-id/{worldId}/map-profile` 目前 status: proposed。需要后端实现此端点，或将此步骤推迟到端点就绪后。

| 模块 | 文件 | 说明 |
|------|------|------|
| Atlas Page | `features/explore/explore-atlas-page.tsx` | 地图视图：location pins + route segments + event anchors + viewport defaults |
| Catalog Gating | `data/catalog.ts` (extension) | `mapAvailability=true` + `map-surface.yaml` enabled profile 双重校验（SJ-MAP-002）|
| Time-Map Linkage | `features/explore/time-map-link.ts` | Timeline 选 world → map focus；map 选 event → timeline highlight（SJ-MAP-004）|
| Fail-Close | components | 缺 profile / 缺字段 → 阻断渲染，显示"地图数据不可用"（SJ-MAP-005）|

### Phase 2 前置数据门槛

| 门槛 | 数据文件 | 最低要求 |
|------|---------|---------|
| **Phase 1 全部验收通过** | — | 对话引擎 + 知识追踪写入侧工作正常 |
| **知识数据积累** | `knowledge_entries` SQLite | 至少完成 1 个完整 session（包含 depth 0/1/2 各级概念）才可验收知识图谱 |
| **地图后端端点** | Realm API | `GET /api/world/by-id/{worldId}/map-profile` 必须从 `proposed` 变为 `existing` 才可验收地图 |
| **地图 profile 数据** | `map-surface.yaml` | `profiles` 中至少 1 个 `enabled: true` 的 world，且 `world-catalog.yaml` 对应条目 `mapAvailability: true` |

### Phase 2 验收标准

- [ ] 知识图谱页正确展示 World → Domain → Concept 分层
- [ ] 点击 World 组节点 → 单 World 知识详情页
- [ ] 跨 World 同一概念有虚线连接
- [ ] 进度页显示按 contentType 分类的统计
- [ ] 成就解锁后 toast 通知
- [ ] Parent mode 可查看 adaptation notes 和 profile
- [ ] 地图视图（如后端端点就绪且 map-surface 有数据）显示 location pins + routes + event anchors

---

## Phase 3: Multimodal（多模态增强）

> 目标：语音、配图、环境音

### Step 3.1 — TTS Voice Output

**对应规则**: SJ-DIAL-010

| 模块 | 说明 |
|------|------|
| `features/session/tts-player.tsx` | AI 生成完成后，提取对白 → `runtime.media.tts.synthesize()` + agent voice binding。non-blocking，文字先出声音后出。全局开关 in settings |

### Step 3.2 — STT Voice Input

**对应规则**: SJ-DIAL-011

| 模块 | 说明 |
|------|------|
| `features/session/stt-recorder.tsx` | 麦克风按钮 → 录音 → `runtime.media.stt.transcribe()` → 填入文本输入框供学生确认后发送 |

### Step 3.3 — Scene Illustration

**对应规则**: SJ-DIAL-012

| 模块 | 说明 |
|------|------|
| `engine/illustration-detector.ts` | 检测配图时机：章节开头、场景转换、campfire、重大转折 |
| `features/session/scene-illustration.tsx` | 二次 prompt 生成 → `runtime.media.image.generate()` → 历史画风配图。non-blocking，本地缓存 |

### Step 3.4 — Ambient Audio

| 模块 | 说明 |
|------|------|
| `features/session/ambient-audio.tsx` | scene type 驱动背景音效切换。预置音效资源文件 |

---

## Phase 4: Polish（完善导出）

### Step 4.1 — Learning Report Export

**对应规则**: SJ-PROG-005

| 模块 | 说明 |
|------|------|
| `features/settings/report-export.tsx` | Parent mode → 选日期范围 → 本地生成 PDF/JSON。含：探索覆盖率、时间分布、domain 概念掌握度、验证分数、章节完成。按 contentType 分类。数据不出设备 |

---

## Cross-Cutting Concerns

### I18n

- 主要语言：zh-CN（中文）
- 次要语言：en（英文）
- 所有 student-facing 文本走 i18n namespace
- 分类标签来自 `content-classification.yaml` 的 `display_label`，不硬编码

### Error Handling

- Bridge 层：typed invoke + Zod 解析 + structured error（reason code + action hint）
- Engine 层：每步 typed error，fail-close 原则
- UI 层：`ShellErrorBoundary`（nimi-kit）包裹 content area

### Testing Strategy

| 层级 | 工具 | 重点 |
|------|------|------|
| Engine unit tests | Vitest | prompt-builder block 优先级 + trim 顺序、choice-parser 各场景、pacing-enforcer 状态机、lorebook-matcher 窗口/限制、explanation-detector precision |
| SQLite integration | Vitest + Tauri test harness | Schema migration、CRUD、index correctness |
| Component tests | Vitest + Testing Library | Timeline 渲染、Agent card 分类 badge、Choice panel 交互 |
| E2E | Playwright + Tauri driver | 完整 onboarding → 对话 → 知识追踪循环 |

### Performance Budget

| 指标 | 目标 |
|------|------|
| 首屏渲染（Bootstrap → Explore visible） | < 3s |
| 对话首 token 延迟 | < 2s（网络依赖） |
| SQLite 查询（单表） | < 50ms |
| Timeline 60+ nodes 滚动 | 60fps |

---

## Implementation Order Summary

```
Phase 0 ──► Scaffold (package.json, vite, tauri, directory structure)
  │
Phase 1 ──► 1.1 App Shell + Auth + Character Encounter (P0, 含 SJ-SHELL-009)
  │         1.2 SQLite Schema (P0, 后续所有本地数据的前置依赖)
  │         1.3 Settings + Profile + Parent Mode (P1, 依赖 1.2)
  │         1.4 Explore: Timeline + World + Agent (P0, 依赖 catalog 有效数据)
  │         1.5 Dialogue Engine (P0, 依赖 1.2 + 1.4 + Realm 内容就绪)
  │         1.6 Knowledge Tracking write side (P0, 依赖 1.5)
  │
Phase 2 ──► 2.1 Knowledge Graph (依赖知识数据积累)
  │         2.2 Progress + Achievements
  │         2.3 Atlas (blocked on backend endpoint + map-surface data)
  │
Phase 3 ──► 3.1 TTS  →  3.2 STT  →  3.3 Illustration  →  3.4 Audio
  │
Phase 4 ──► 4.1 Report Export
```

每个 Step 完成后运行 typecheck + build + 相关测试，确保不引入回归。
