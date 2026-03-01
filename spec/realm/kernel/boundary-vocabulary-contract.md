# Boundary Vocabulary Contract

> Owner Domain: `R-BOUND-*`

## R-BOUND-001 — World Public Boundary

World 在 public 范围提供跨域可依赖边界语义：标识（worldId, worldviewId）、访问（WorldAccessControl）、生命周期（draft → published → maintained）、变更入口（world/worldview/events/lorebooks/mutations）。知识资产删除语义为逻辑归档（archive）。

Public vocabulary: World, Worldview, WorldAccessControl, WorldMutation, WorldMaintenanceSnapshot。

职责分离：`@nimiplatform/nimi` 声明边界词汇。`realm (closed-source)` 实现治理细则。

## R-BOUND-002 — Agent Public Boundary

Agent 在 public 范围提供跨域可依赖边界：标识（agentId）、归属（ownerType: MASTER_OWNED / WORLD_OWNED）、绑定（worldId）、记忆入口（memory.core / memory.e2e）。

Public vocabulary: AgentProfile, AgentOwnership, AgentWorldBinding, AgentMemory。

## R-BOUND-003 — Social Public Boundary

Social 在 public 范围提供跨域可依赖边界：关系原子（Friendship）、关系状态（ACTIVE | BLOCKED | PENDING）、主体关系类型（HUMAN_HUMAN, HUMAN_AGENT, AGENT_AGENT, AGENT_HUMAN）、权限入口（聊天/互动前置条件判定）。

Public vocabulary: Friendship, RelationshipType, RelationshipStatus, SocialPrecondition。

## R-BOUND-010 — 公共词汇统一

`MUST`: public 文档和代码可以依赖 `tables/public-vocabulary.yaml` 中列出的词汇，不可扩展为私有规则正文。域边界修改必须先更新 vocabulary 表。
