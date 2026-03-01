# Future Capabilities

> Status: Draft
> Date: 2026-03-01
> Scope: 未来能力规划 backlog，汇总研究报告中可借鉴项，按优先级分类管理。

## 1. 目标

本目录是 Nimi 平台未来能力的结构化 backlog。
所有条目从研究报告中提取，经审计后进入 backlog，按优先级和类别组织，成熟后毕业到 `spec/runtime/` 或 `spec/sdk/`。

## 2. 目录结构

- `kernel/` — 治理规则（Rule ID `F-*`）
- `kernel/tables/` — YAML 事实源
- `kernel/generated/` — 自动生成的表格视图

## 3. Task-Oriented 阅读路径

### 添加新的未来能力条目

1. `spec/future/kernel/source-registry.md` — 确认来源已注册
2. `spec/future/kernel/capability-backlog.md` — 条目结构与生命周期
3. `spec/future/kernel/tables/backlog-items.yaml` — 添加条目

### 审查 backlog 优先级

1. `spec/future/kernel/generated/backlog-items.md` — 按优先级分组查看
2. `spec/future/kernel/capability-backlog.md` — 优先级标准

### 毕业条目到正式 spec

1. `spec/future/kernel/graduation-contract.md` — 毕业条件与流程
2. `spec/future/kernel/tables/graduation-log.yaml` — 记录毕业日志
