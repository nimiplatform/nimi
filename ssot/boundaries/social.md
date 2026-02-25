---
title: Social Boundary Stub (Public)
status: ACTIVE
updated_at: 2026-02-25
rules:
  - 本文件只定义 social 域在 public 仓的边界接口与责任，不包含闭源实现细节。
  - social 对外语义只保留关系原子事实与权限判定入口，不复制私有业务规则正文。
  - public 侧引用 social 语义时必须引用本边界桩，不得引用不存在的 social 正文。
---

# Social Public Boundary

## 1. Scope

`social` 在 public 范围内仅提供跨域可依赖边界：

1. 关系原子：`Friendship`
2. 关系状态：`ACTIVE | BLOCKED | PENDING`
3. 主体关系类型：`HUMAN_AGENT`、`AGENT_AGENT`、`AGENT_HUMAN`
4. 权限入口：聊天/互动前置条件判定

## 2. Public Vocabulary

1. `Friendship`
2. `RelationshipType`
3. `RelationshipStatus`
4. `SocialPrecondition`

## 3. Responsibility Split

1. `@nimiplatform/nimi`：声明可引用关系词汇与权限前置锚点。
2. `realm (closed-source)`：实现关系图谱、规则评估、风控与审计闭环。

## 4. Non-goals

本文件不定义以下内容：

1. 社交推荐与排序算法
2. 黑名单/反骚扰策略细则
3. 内部关系边写路径实现
