# Graduation Contract

> Scope: Backlog 条目毕业到现有 spec 域的条件、流程与跟踪。

## F-GRAD-001 毕业条件

条目从 `accepted` 毕业到 `spec-drafted` 必须满足：

1. 条目 `status` 为 `accepted`。
2. 已确定目标 spec 路径（`target_spec_path`）。
3. 已有明确的 kernel Rule ID 分配方案。
4. 已完成架构影响评估（`architecture_notes` 非空且具体）。
5. 目标 spec 域的 mandatory verification commands 必须通过，至少包含 `check:<domain>-spec-kernel-consistency` 与 `check:<domain>-spec-kernel-docs-drift`。此条件确保毕业后的 spec 不会破坏已有的一致性守护。
6. `target_layers` 包含 `web` 时，不创建独立 `spec/web/` 域；必须毕业到现有 `.nimi/spec/desktop/` 投影文档（优先 `.nimi/spec/desktop/web-adapter.md`）并沿用 `desktop` 域检查。
7. 如条目语义依赖 `.nimi/spec/platform/**` 或 `.nimi/spec/realm/**` 的现有 kernel 规则 / tables，目标文档必须显式 import 并复用这些规则；不得复制协议、原语、经济或边界词汇正文。

## F-GRAD-002 毕业流程

1. 在目标 spec 域（`.nimi/spec/runtime/`、`.nimi/spec/sdk/` 或 `.nimi/spec/desktop/`）创建或扩展对应文档。
   其中如涉及 Platform / Realm 既有语义，必须在同次变更中补齐对应 kernel imports 与阅读路径。
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
