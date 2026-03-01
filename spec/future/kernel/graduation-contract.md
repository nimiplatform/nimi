# Graduation Contract

> Status: Draft
> Date: 2026-03-01
> Scope: Backlog 条目毕业到 spec/runtime 或 spec/sdk 的条件、流程与跟踪。

## F-GRAD-001 毕业条件

条目从 `accepted` 毕业到 `spec-drafted` 必须满足：

1. 条目 `status` 为 `accepted`。
2. 已确定目标 spec 路径（`target_spec_path`）。
3. 已有明确的 kernel Rule ID 分配方案。
4. 已完成架构影响评估（`architecture_notes` 非空且具体）。
5. 目标 spec 域的 CI 一致性检查必须通过（对应 `check:<domain>-spec-kernel-consistency`）。此条件确保毕业后的 spec 不会破坏已有的一致性守护。

## F-GRAD-002 毕业流程

1. 在目标 spec 域（`spec/runtime/` 或 `spec/sdk/`）创建或扩展对应文档。
2. 在 `graduation-log.yaml` 追加一条毕业记录。
3. 在 `backlog-items.yaml` 中将条目 `status` 更新为 `spec-drafted`。
4. 以上三步必须在同一次变更中完成。

## F-GRAD-003 毕业日志结构

每条毕业日志必须包含：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `item_id` | string | yes | 对应 backlog 条目 ID |
| `graduated_date` | string | yes | 毕业日期（`YYYY-MM-DD`） |
| `target_spec_path` | string | yes | 目标 spec 文件路径 |
| `target_rule_ids` | list | yes | 分配的 kernel Rule ID 列表 |
| `notes` | string | no | 毕业备注 |

## F-GRAD-004 毕业不可逆

- 毕业日志（`graduation-log.yaml`）一旦写入不可删除或修改。
- 毕业后条目在 `backlog-items.yaml` 中保留，仅 `status` 字段变更。
- 如毕业后发现问题，在目标 spec 域处理，不回退 backlog 状态。
