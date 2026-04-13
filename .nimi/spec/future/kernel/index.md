# Future Kernel Contracts

> Scope: 未来能力 backlog 治理规则、条目生命周期、研究来源注册与毕业流程。

## 1. 目标

本目录是 Future Capabilities 规范的唯一权威层（kernel layer）。
任何 backlog 条目、来源注册、毕业流程的治理规则只能在 kernel 定义一次。

## 2. One Fact One Home

- 单一事实源：同一规则只允许在一个 kernel 文件定义。
- YAML 表是唯一数据源：条目数据只存在于 `tables/*.yaml`。
- 冲突处理：若 generated 与 tables 冲突，以 tables 为准；regenerate 解决。

## 3. Rule ID 规范

- 格式：`F-<DOMAIN>-NNN`
- 示例：`F-CAP-001`、`F-GRAD-002`、`F-SRC-003`
- 规则：
  - `DOMAIN` 固定枚举：`CAP` `GRAD` `SRC`
  - `NNN` 三位递增编号，不复用。

## 4. 文档所有权

| 文档 | Domain | 说明 |
|---|---|---|
| `capability-backlog.md` | `F-CAP-*` | Backlog 条目结构、优先级、生命周期 |
| `graduation-contract.md` | `F-GRAD-*` | 毕业条件、流程、后续跟踪 |
| `source-registry.md` | `F-SRC-*` | 研究来源元数据与结论摘要注册规范 |

## 5. 结构化事实源

`tables/` 目录中的 YAML 是后续自动生成表格与 lint 的事实源：

- `tables/backlog-items.yaml`
- `tables/research-sources.yaml`
- `tables/graduation-log.yaml`

## 6. 结构约束

- backlog 条目的 `source_ids` 必须可解析到 `research-sources.yaml`。
- 条目 `item_id` 格式必须为 `F-<MNEMONIC>-NNN`，其中 `MNEMONIC` 为 2-12 个大写字母。
- 来源 `source_id` 格式必须为 `RESEARCH-<ABBREV>-NNN`。
- 条目永不删除：`rejected`/`implemented` 都保留，保证可追溯性。
