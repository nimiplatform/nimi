---
title: World Boundary Stub (Public)
status: ACTIVE
updated_at: 2026-02-25
rules:
  - 本文件只定义 world 域在 public 仓的边界接口与责任，不包含闭源实现细节。
  - world 语义对外只暴露稳定词汇与交互契约，具体治理规则留在 realm 私有域。
  - public 侧引用 world 语义时必须引用本边界桩，不得引用不存在的 world 正文。
---

# World Public Boundary

## 1. Scope

`world` 在 public 范围内仅提供跨域可依赖的边界语义：

1. 标识：`worldId`、`worldviewId`
2. 访问：`WorldAccessControl`（是否可创建/维护/发布）
3. 生命周期：`draft -> published -> maintained`（高层状态）
4. 变更入口：`world/worldview/events/lorebooks/mutations`（事务域名）
5. 知识资产生命周期：`events/lorebooks` 删除语义为逻辑归档（archive），不承诺物理硬删

## 2. Public Vocabulary

public 文档和代码可以依赖以下词汇，不可扩展为私有规则正文：

1. `World`
2. `Worldview`
3. `WorldAccessControl`
4. `WorldMutation`
5. `WorldMaintenanceSnapshot`

## 3. Responsibility Split

1. `@nimiplatform/nimi`：声明边界词汇、可见契约、跨域引用锚点。
2. `realm (closed-source)`：实现治理细则、状态机细节、策略判定与持久化规则。

## 4. Non-goals

本文件不定义以下内容：

1. world level 公式与配额算法
2. 发布审批细则
3. 内部风控与反作弊策略
