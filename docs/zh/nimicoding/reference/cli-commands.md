# Nimi 命令参考

Nimi 仓库已准入 Nimi Coding 表面的字段级参考。所有权概念见
[命令表面](/zh/nimicoding/cli)。

## 宿主边界命令

| 命令 | 用途 |
| --- | --- |
| `pnpm check:nimi-coding-seed-sync` | 检查受管文件是否齐全、package-canonical 内容是否漂移 |
| `pnpm nimicoding:doctor` | 检查 bootstrap、受管文件和宿主规范配置 |

## 规范与治理 Validators

| 命令 | 用途 |
| --- | --- |
| `pnpm exec nimicoding validate-spec-tree [.nimi/spec]` | 验证 canonical tree 结构 |
| `pnpm exec nimicoding validate-spec-audit [audit-path]` | 验证来源证据、推断和未解决缺口 |
| `pnpm exec nimicoding validate-spec-governance --profile nimi --scope {scope}` | 验证配置的治理范围 |
| `pnpm exec nimicoding classify-spec-tree --profile nimi --root .nimi/spec [--json]` | 分类规范条目 |
| `pnpm exec nimicoding generate-spec-migration-plan --profile nimi --root .nimi/spec [--emit {path}] [--json]` | 生成不修改源文件的描述性迁移计划 |
| `pnpm exec nimicoding validate-placement --profile nimi --root .nimi/spec [--json]` | 验证 placement contracts |
| `pnpm exec nimicoding validate-table-family --profile nimi --root .nimi/spec [--json]` | 验证 table-family contracts |
| `pnpm exec nimicoding validate-projection-edges --profile nimi --root .nimi/spec [--json]` | 验证 projection edges |
| `pnpm exec nimicoding validate-guidance-bodies --profile nimi --root .nimi/spec [--json]` | 验证 guidance bodies |
| `pnpm exec nimicoding validate-domain-admission --profile nimi --root .nimi/spec [--json]` | 验证 domain admission records |
| `pnpm exec nimicoding validate-tracked-output-admission --profile nimi --root .nimi/spec [--json]` | 验证 tracked-output admission |
| `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope {scope} --check` | 检查 derived docs |
| `pnpm exec nimicoding validate-ai-governance --profile nimi --scope {scope}` | 验证 AI 治理约束 |
| `pnpm exec nimicoding blueprint-audit [--blueprint-root {path}] [--canonical-root {path}] [--json] [--write-local]` | 比较 blueprint 与 canonical spec roots |

## 规范构建契约

宿主直接读取这些输入和契约：

| 文件 | 用途 |
| --- | --- |
| `.nimi/config/spec-generation-inputs.yaml` | Nimi 专用、已分类的构建输入 |
| `.nimi/methodology/spec-reconstruction.yaml` | 构建目标、目录形态和完成门禁 |
| `.nimi/contracts/spec-generation-audit.schema.yaml` | 本地文件级来源与缺口证据 |
| `.nimi/contracts/spec-layout.schema.yaml` | 宿主指令与受管生成目录的布局准入 |

`classify-spec-tree` 与 `generate-spec-migration-plan` 只分析规范树。它们的输出是证据，
不是工作队列、执行计划或任务状态。

## 执行边界

规划、实现、复核与完成属于宿主状态。Nimi Coding 0.3.x 不提供 topic、sweep、
handoff、closeout 或 provider runtime 命令族。

## 来源依据

- [`.nimi/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/spec-reconstruction.yaml)
- [`.nimi/contracts/spec-generation-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-generation-audit.schema.yaml)
- [`.nimi/contracts/spec-layout.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-layout.schema.yaml)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
