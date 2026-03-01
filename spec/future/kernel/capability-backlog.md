# Capability Backlog

> Status: Draft
> Date: 2026-03-01
> Scope: Backlog 条目结构、优先级分类、状态生命周期。

## F-CAP-001 Backlog 条目必填字段

每个 backlog 条目必须包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `item_id` | string | yes | 格式 `F-<MNEMONIC>-NNN`，全局唯一 |
| `title` | string | yes | 简短标题 |
| `priority` | enum | yes | `high` / `medium` / `low` |
| `category` | enum | yes | 见 F-CAP-004 |
| `target_layers` | list | yes | 受影响层：`runtime` / `sdk` / `desktop` / `web` |
| `status` | enum | yes | 见 F-CAP-003 |
| `source_ids` | list | yes | 至少一个 `RESEARCH-*` 来源引用 |
| `complexity` | enum | yes | `small` / `medium` / `large` |
| `depends_on` | list | no | 依赖的其他 backlog 条目 `item_id` 列表 |
| `architecture_notes` | string | yes | 架构影响简述 |

## F-CAP-002 优先级分类标准

- **high**：直接影响核心用户体验或竞品差距明显，实施路径清晰。
- **medium**：增强平台能力或集成度，有明确需求但不阻塞核心流程。
- **low**：长期能力储备，当前无紧迫需求或依赖外部标准成熟。

## F-CAP-003 状态生命周期

```text
proposed → accepted → spec-drafted → implemented
                   ↘ rejected
                   ↘ deferred
```

- **proposed**：从研究报告中提取，待审计。
- **accepted**：审计通过，进入活跃 backlog。
- **spec-drafted**：已有对应的 `spec/runtime/` 或 `spec/sdk/` 草案。
- **implemented**：已在代码中实现并合入。
- **rejected**：审计后认为不适用或不符合平台方向。
- **deferred**：暂缓，等待外部条件成熟。

## F-CAP-004 Category 枚举

| Category | 说明 |
|---|---|
| `ux` | 用户体验改进（渲染、交互、编辑器） |
| `integration` | 外部协议/服务集成（MCP、搜索、OAuth） |
| `platform` | 平台核心能力（RAG、工作流、模型路由） |
| `auth` | 认证与授权扩展 |
| `security` | 安全与审核能力 |
| `observability` | 可观测性与运维 |

## F-CAP-005 依赖关系约束

- `depends_on` 中引用的每个 `item_id` 必须存在于 `backlog-items.yaml`。
- 不允许自引用（条目不能依赖自身）。
- 不允许循环依赖（A→B→…→A）。
- 依赖是软约束：表达推荐的实施顺序，不阻塞独立开发。
