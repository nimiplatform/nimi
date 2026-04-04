# ShiJi (时迹) Spec Index

> 时迹 — 上下五千年沉浸式历史教育 App
> 独立 Tauri 桌面应用，面向中小学生

## Domain

| Document | Scope |
|----------|-------|
| [shiji.md](shiji.md) | 产品定位、内容边界、技术栈、架构、非目标 |

## Kernel Contracts

| Contract | Rule IDs | Scope |
|----------|----------|-------|
| [app-shell-contract.md](kernel/app-shell-contract.md) | SJ-SHELL-001 ~ 009 | App Shell + Bootstrap + Auth + Profile + 首次体验 |
| [explore-contract.md](kernel/explore-contract.md) | SJ-EXPL-001 ~ 012 | 时间长河浏览 + 人物选择 + 分类校验 + 叙事过渡 + 多视角 |
| [map-contract.md](kernel/map-contract.md) | SJ-MAP-001 ~ 005 | 历史地图视图 + 时空联动（当前仍是 blocked surface） |
| [dialogue-contract.md](kernel/dialogue-contract.md) | SJ-DIAL-001 ~ 019 | 对话引擎管线 + 内容真值边界 + learner 适配 + 轻量互动 + 时间沉浸（当前不包含 events/scenes 依赖） |
| [knowledge-contract.md](kernel/knowledge-contract.md) | SJ-KNOW-001 ~ 008 | 知识脚手架 + 类型化追踪 + 发现式学习 |
| [progress-contract.md](kernel/progress-contract.md) | SJ-PROG-001 ~ 007 | 学习进度 + learner 画像 + 报告分层 |

## Fact Sources

| Table | Scope |
|-------|-------|
| [routes.yaml](kernel/tables/routes.yaml) | 路由表 |
| [feature-matrix.yaml](kernel/tables/feature-matrix.yaml) | 功能矩阵（阶段/优先级/依赖） |
| [api-surface.yaml](kernel/tables/api-surface.yaml) | 消费的 Realm API 端点 |
| [world-catalog.yaml](kernel/tables/world-catalog.yaml) | 时迹白名单 World 目录 |
| [content-classification.yaml](kernel/tables/content-classification.yaml) | 内容类型 / 真值模式枚举 |
| [map-surface.yaml](kernel/tables/map-surface.yaml) | 地图 profile 数据面 |
| [local-storage.yaml](kernel/tables/local-storage.yaml) | 本地学习数据 SQLite 表 |

## Authoritative Imports

- `spec/sdk/kernel/surface-contract.md` — S-SURFACE-*
- `spec/realm/kernel/truth-contract.md` — R-TRUTH-*
- `spec/realm/kernel/world-history-contract.md` — R-WHIST-*
- `spec/realm/kernel/agent-memory-contract.md` — R-MEM-*
- `spec/runtime/kernel/multimodal-provider-contract.md` — K-MMPROV-*
