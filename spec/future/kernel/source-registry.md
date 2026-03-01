# Source Registry

> Status: Draft
> Date: 2026-03-01
> Scope: 研究报告注册与引用规范。

## F-SRC-001 Source ID 格式

- 格式：`RESEARCH-<ABBREV>-NNN`
- `ABBREV`：2-6 个大写字母缩写，标识研究类别或对象。
- `NNN`：三位递增编号。
- 示例：`RESEARCH-OWUI-001`、`RESEARCH-DIFY-001`

## F-SRC-002 来源必填字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `source_id` | string | yes | 格式见 F-SRC-001 |
| `title` | string | yes | 报告标题 |
| `path` | string | yes | 相对于仓库根的文件路径 |
| `date` | string | yes | 报告日期（`YYYY-MM-DD`） |
| `scope` | string | yes | 报告覆盖范围简述 |

## F-SRC-003 路径有效性

- `path` 必须指向仓库中实际存在的文件。
- 一致性检查脚本验证路径存在性。

## F-SRC-004 引用要求

- backlog 条目的 `source_ids` 中每个 ID 必须在 `research-sources.yaml` 中注册。
- 未注册的 source ID 在一致性检查中报错。
