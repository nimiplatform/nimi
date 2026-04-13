# Source Registry

> Scope: 研究来源元数据与结论摘要注册规范。

## F-SRC-001 Source ID 格式

- 格式：`RESEARCH-<ABBREV>-NNN`
- `ABBREV`：2-6 个大写字母缩写，标识研究类别或对象。
- `NNN`：三位递增编号。
- 示例：`RESEARCH-OWUI-001`、`RESEARCH-DIFY-001`

## F-SRC-002 来源必填字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `source_id` | string | yes | 格式见 F-SRC-001 |
| `title` | string | yes | 来源标题 |
| `date` | string | yes | 来源日期（`YYYY-MM-DD`） |
| `source_kind` | string | yes | 来源类别：`public_reference`、`internal_research`、`local_evidence`、`spec_derived` |
| `access` | string | yes | 访问边界：`public`、`private`、`local_only` |
| `scope` | string | yes | 来源覆盖范围简述 |
| `conclusion` | string | yes | 对 future backlog 有效的蒸馏结论或决策相关摘要 |

## F-SRC-003 工件路径独立性

- 来源注册的 canonical model 仅包括可跟踪的元数据与蒸馏结论。
- 不要求、也不得依赖 repo 或 local workspace 中存在具体研究工件文件。
- 一致性检查脚本不得把 concrete artifact path existence 作为来源注册有效性的前提。

## F-SRC-004 引用要求

- backlog 条目的 `source_ids` 中每个 ID 必须在 `research-sources.yaml` 中注册。
- 未注册的 source ID 在一致性检查中报错。
