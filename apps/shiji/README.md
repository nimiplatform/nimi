# 时迹 (ShiJi)

> 上下五千年沉浸式历史教育 App

## 产品定位

时迹是 nimi 生态中的独立 Tauri 桌面应用，面向中小学生（8-15 岁），提供跨越五千年中国历史的沉浸式角色扮演教育体验。

用户浏览和选择 nimi 平台提供的历史时期（World）和历史人物（Agent），以历史人物第一人称视角展开对话，在博弈、抉择和反思中理解历史。

## 核心体验

- **时间长河**：从先秦到近代，浏览所有可探索的历史时期
- **人物对话**：选择历史人物，以第一人称沉浸式对话
- **知识脚手架**：历史知识以人物口吻自然嵌入，追踪学习进度
- **结构化选择**：A/B 抉择节点，附代价推演，培养历史判断力
- **多模态**：TTS 语音朗读、场景配图、环境音、语音输入

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2 |
| 前端 | React 19 + Vite 7 + Tailwind 4 |
| 状态管理 | Zustand 5 + TanStack Query 5 |
| 路由 | React Router 7 (HashRouter) |
| UI 基础 | @nimiplatform/nimi-kit |
| 平台接入 | @nimiplatform/sdk (runtime + realm) |
| 持久化 | SQLite (via Tauri) |
| 国际化 | i18next |

## 项目结构

```
apps/shiji/
├── README.md
├── AGENTS.md
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   └── shell/
│       └── renderer/
│           ├── main.tsx
│           ├── App.tsx
│           ├── app-shell/         # Layout, providers, error boundary
│           ├── bridge/            # Tauri IPC
│           ├── state/             # Zustand stores
│           ├── data/              # SDK realm data clients
│           ├── engine/            # 对话引擎
│           │   ├── dialogue-pipeline.ts
│           │   ├── prompt-builder.ts
│           │   ├── pacing-enforcer.ts
│           │   ├── knowledge-scaffolder.ts
│           │   ├── choice-parser.ts
│           │   └── trunk-convergence.ts
│           ├── features/
│           │   ├── explore/       # 时期浏览 + 人物选择
│           │   ├── session/       # 沉浸式对话
│           │   ├── knowledge/     # 知识图谱
│           │   └── progress/      # 学习进度 + 成就
│           ├── hooks/
│           └── components/
├── src-tauri/
│   ├── tauri.conf.json
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       └── runtime_bridge/
├── spec/                          # 产品规格
│   ├── INDEX.md
│   ├── AGENTS.md
│   ├── shiji.md
│   └── kernel/
│       ├── app-shell-contract.md
│       ├── explore-contract.md
│       ├── dialogue-contract.md
│       ├── knowledge-contract.md
│       ├── progress-contract.md
│       └── tables/
│           ├── routes.yaml
│           ├── feature-matrix.yaml
│           └── api-surface.yaml
└── dist/
```

## 工作区集成

- 包名: `@nimiplatform/shiji`
- 工作区: `nimi/` pnpm workspace
- 开发端口: `1425`
- Tauri 标识符: `app.nimi.shiji`
- App ID: `nimi.shiji`

## 开发命令

```bash
pnpm --filter @nimiplatform/shiji dev:renderer   # 前端开发服务器
pnpm --filter @nimiplatform/shiji dev:shell       # Tauri 桌面运行
pnpm --filter @nimiplatform/shiji typecheck       # 类型检查
pnpm --filter @nimiplatform/shiji build           # 构建
pnpm --filter @nimiplatform/shiji test            # 测试
```

## 与 nimi 生态的关系

| 维度 | 说明 |
|---|---|
| **内容来源** | World（历史时期）和 Agent（历史人物）由 nimi 通过 Forge 创建维护 |
| **AI 能力** | 通过 nimi runtime 获取文本生成、TTS、STT、图像生成 |
| **用户体系** | 复用 nimi 账户体系和 Auth 流程 |
| **独立运行** | 独立进程和窗口，非 Desktop mod |
