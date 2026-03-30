# 时迹 (ShiJi) — Top-Level Product Spec

> Status: Draft | Date: 2026-03-30

## Product Positioning

时迹是 nimi 生态中面向中小学生（8-15 岁）的独立 Tauri 桌面应用，提供以中华文明时间轴为骨架的通识教育体验。产品范围固定为中华上下五千年的历史主线，并允许将传统文学与神话内容作为辅助学习世界挂载到同一时间长河中。

时迹不是通用 world 浏览器，也不是教育平台壳层。它只消费通过时迹目录白名单审核的 World/Agent，并以儿童教育安全、历史脉络理解和持续学习追踪为第一优先级。

核心产品循环：

1. **探索** — 沿时间长河浏览白名单 World，理解先后顺序、时代标签、内容类型与真值模式
2. **进入人物** — 选择该世界下的历史人物或故事人物，以角色视角进入情境
3. **对话学习** — 通过对话、选择、验证与回顾理解历史因果、制度、人物关系与文化母题
4. **积累成长** — 在知识图谱、章节进度和学习报告中沉淀长期学习记录

时迹不创建或编辑 World/Agent 内容。内容由 nimi 运营团队通过 Forge 创建维护，时迹只消费目录白名单中的内容。

## Content Scope

时迹的内容边界固定如下：

1. **主线内容** — 中华历史 world，构成产品主课程和时间长河主骨架
2. **辅助内容** — 与特定历史时期相关的传统文学与神话 world，用于增强兴趣、视角与文化理解
3. **统一导航** — 历史、文学、神话共享同一条时间长河，但每个节点都必须明确标注 `contentType` 与 `truthMode`
4. **目录准入** — 只有出现在 `kernel/tables/world-catalog.yaml` 且状态允许的 world 才能被时迹展示

文学与神话内容不得反向主导产品结构，也不得在 UI、对话或学习报告中被描述为 canonical history。

## Learner Adaptation Model

时迹不是面向匿名用户的一次性聊天产品。它面向被家长或监护人明确配置过学习画像的儿童学习者，并允许 AI 根据该画像和长期互动记录进行针对性适配。

适配模型由三层组成：

1. **监护人输入层** — 家长/监护人在受保护入口录入孩子的年龄、年级段、兴趣、擅长领域、表达方式、学习目标与注意事项
2. **会话观察层** — App 在本地沉淀经确认的互动偏好，例如偏好短输入、擅长博弈类比、对结构化 A/B 抉择响应更好
3. **Prompt 适配层** — 对话引擎把这两层信息注入 prompt，用于调整讲解密度、比喻框架、角色关系锚点、验证方式与节奏控制

所有 learner adaptation 数据均为本地教育数据，不同步到 Realm truth，也不改变 world/agent 的 canonical 内容边界。

## Target Audience

| 维度 | 描述 |
|------|------|
| 年龄段 | 8-15 岁（小学高年级到初中） |
| 核心需求 | 在游戏化体验中学习历史，理解因果而非死记硬背 |
| 认知特点 | 逻辑能力发展中，需要具象化的知识传递方式 |
| 交互偏好 | 选择题优于开放式提问，语音输入优于长文本打字 |
| 安全要求 | 内容安全（无暴力渲染/政治敏感）、真值标注明确、时长提醒、家长可查看报告 |

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2 |
| Frontend | React 19 + Vite 7 + Tailwind 4 |
| State management | Zustand 5 |
| Data fetching | TanStack Query 5 |
| Routing | React Router 7 (HashRouter) |
| I18n | i18next + react-i18next |
| SDK | `@nimiplatform/sdk/runtime` + `@nimiplatform/sdk/realm` |
| Shell core | `@nimiplatform/nimi-kit` |

时迹通过 SDK 根 bootstrap 连接两个平台平面：
- **Platform client** — `createPlatformClient({ appId: 'nimi.shiji', runtimeTransport: 'tauri-ipc', sessionStore })`
- **Runtime / Realm** — consumed from the returned SDK client

Tauri shell 仅提供 runtime defaults 和生命周期支持。业务请求不直接调用 Tauri bridge helpers。

## Navigation Model

时迹采用“单一时间长河 + 第二视图地图”的导航模型：

1. **时间长河** 是唯一主导航，所有白名单 world 都按目录顺序挂载在同一河流上
2. **内容标签** 与 **真值标签** 必须在浏览节点、详情页和对话入口中持续可见
3. **地图视图** 是 Phase 2 的 Explore 第二视图，只服务于具备地图 profile 的 world
4. **地图不替代时间线**，只补充地点、路径、事件锚点和时空联动理解

## Project Location

```
nimi/apps/shiji/
├── src-tauri/                    # Rust Tauri shell
│   ├── src/
│   │   └── lib.rs
│   ├── tauri.conf.json
│   └── Cargo.toml
├── src/
│   └── shell/
│       └── renderer/             # Vite root
│           ├── main.tsx
│           ├── App.tsx
│           ├── app-shell/        # Layout, providers, error boundary
│           ├── bridge/           # Tauri IPC (runtime defaults, daemon, oauth)
│           ├── state/            # Zustand stores
│           ├── data/             # SDK realm data clients
│           ├── engine/           # Dialogue engine (core pipeline)
│           ├── features/         # Feature page modules
│           ├── hooks/            # Shared React hooks
│           └── components/       # Shared UI components
├── spec/                         # This spec tree
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Workspace Integration

- Package name: `@nimiplatform/shiji`
- Workspace: `nimi/` pnpm workspace, pattern `apps/*` auto-discovers
- Dev server port: `1425`
- Tauri identifier: `app.nimi.shiji`
- App ID: `nimi.shiji`

## Module Map

| Module | Implementation Path |
|--------|-------------------|
| App entry | `src/shell/renderer/main.tsx` |
| Bootstrap | `src/shell/renderer/app-shell/bootstrap.ts` |
| Auth providers | `src/shell/renderer/app-shell/providers.tsx` |
| Bridge layer | `src/shell/renderer/bridge/` |
| Realm data clients | `src/shell/renderer/data/` |
| Dialogue pipeline | `src/shell/renderer/engine/dialogue-pipeline.ts` |
| Prompt builder | `src/shell/renderer/engine/prompt-builder.ts` |
| Pacing enforcer | `src/shell/renderer/engine/pacing-enforcer.ts` |
| Knowledge scaffolder | `src/shell/renderer/engine/knowledge-scaffolder.ts` |
| Choice parser | `src/shell/renderer/engine/choice-parser.ts` |
| Trunk convergence | `src/shell/renderer/engine/trunk-convergence.ts` |
| Explore feature | `src/shell/renderer/features/explore/` |
| Session feature | `src/shell/renderer/features/session/` |
| Knowledge feature | `src/shell/renderer/features/knowledge/` |
| Progress feature | `src/shell/renderer/features/progress/` |
| App state | `src/shell/renderer/state/` |

## Relationship to Other Apps

| Aspect | Desktop | Forge | ShiJi |
|--------|---------|-------|-------|
| Identifier | `app.nimi.desktop` | `app.nimi.forge` | `app.nimi.shiji` |
| Dev port | 1420 | 1422 | 1425 |
| Mod system | Full mod runtime | None | None |
| Content role | Consumer + mod host | Creator + publisher | Consumer only |
| Target user | General | Creators | K-12 students |
| AI pipeline | Mod-delegated | Advisory | Dialogue engine |

## Content Governance

时迹的内容治理同时依赖 Realm truth 和 app 自有目录：

| Layer | Authority | Purpose |
|-------|-----------|---------|
| Realm truth | WorldRule / AgentRule / Lorebook / Event | 定义世界与人物的 canonical 内容边界 |
| ShiJi catalog | `world-catalog.yaml` | 决定哪些 world 允许进入时迹，以及展示顺序和教育元数据 |
| ShiJi classification | `content-classification.yaml` | 规定内容类型与真值模式的合法组合 |
| ShiJi local storage | `local-storage.yaml` | 定义本地学习记录、会话、知识、进度与报告数据 |
| ShiJi learner adaptation | local learner profile + notes | 定义监护人输入的孩子画像和已确认的互动偏好 |

## Content Model

时迹消费而非创建内容。内容由 nimi 通过 Forge 创建：

| Realm Entity | 在时迹中的角色 | 示例 |
|---|---|---|
| World | 时间轴上的学习世界（历史主线或辅助故事内容） | "大唐盛世"、`三国演义` world |
| Agent (PRIMARY) | 可选主要人物 | 李世民、武则天、诸葛亮 |
| Agent (SECONDARY) | 配角人物 | 魏征、长孙无忌、哪吒 |
| WorldRule | 叙事治理规则 | 节奏控制、选项格式、知识脚手架 |
| AgentRule | 人物行为边界 | 身份、口吻、知识约束 |
| WorldLorebook | 历史/文化知识条目 | 科举制、均田制、封神母题 |
| CreatorWorldEvent | 主干锁定事件或故事节点 | 玄武门之变、安史之乱 |
| Scene | 场景地点 | 长安大明宫、洛阳 |
| Binding (AGENT_AVATAR) | 人物头像 | 历史人物画像 |
| Binding (AGENT_VOICE_SAMPLE) | 人物语音 | TTS 声音基底 |

## Non-Goals

- 不创建或编辑 World/Agent 内容（Forge 职责）
- 不实现 mod 系统
- 不实现世界史扩展或通用教育平台能力
- 不管理本地 AI 模型（依赖 runtime daemon）
- 不实现离线模式（v1）
- 不实现多人/课堂模式（v1）
- 不把文学/神话内容伪装成 canonical 历史事实
- 不让文学/神话反向成为产品主导航或主课程
