---
title: Agent Boundary Stub (Public)
status: ACTIVE
updated_at: 2026-02-25
rules:
  - 本文件只定义 agent 域在 public 仓的边界接口与责任，不包含闭源实现细节。
  - agent 对外语义只保留身份与绑定层，不复制私有策略与内部状态机。
  - public 侧引用 agent 语义时必须引用本边界桩，不得引用不存在的 agent 正文。
---

# Agent Public Boundary

## 1. Scope

`agent` 在 public 范围内仅提供跨域可依赖边界：

1. 标识：`agentId`
2. 归属：`ownerType`（如 `MASTER_OWNED` / `WORLD_OWNED`）
3. 绑定：`worldId`（可选）
4. 记忆入口：`memory.core` / `memory.e2e`（边界名词）

## 2. Public Vocabulary

1. `AgentProfile`
2. `AgentOwnership`
3. `AgentWorldBinding`
4. `AgentMemory`（仅边界分类，不含内部存储细节）

## 3. Responsibility Split

1. `@nimiplatform/nimi`：声明 agent 边界词汇与跨域依赖面。
2. `realm (closed-source)`：实现人格策略、行为执行约束、记忆治理细则。

## 4. Non-goals

本文件不定义以下内容：

1. agent 行为策略 DSL
2. 私有 memory 评分与召回排序算法
3. 内部 persona/brain/worldview 配置模板
