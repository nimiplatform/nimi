# Nimi 命令参考

Nimi 仓库已准入 Nimi Coding 表面的字段级参考。所有权概念见
[命令表面](/zh/nimicoding/cli)。

## Host Compatibility Wrappers

| 命令 | 用途 |
| --- | --- |
| `pnpm check:nimicoding-host-hardcut` | 验证禁用执行投影缺失，host-owned 投影已准入 |
| `pnpm check:nimi-coding-seed-sync` | 通过 compatibility policy 检查 package projection drift |
| `pnpm nimicoding:doctor` | 通过严格 host compatibility wrapper 运行 doctor |

## 规范与治理 Validators

| 命令 | 用途 |
| --- | --- |
| `pnpm exec nimicoding validate-spec-tree [.nimi/spec]` | 验证 canonical tree 结构 |
| `pnpm exec nimicoding validate-spec-audit [audit-path]` | 验证来源证据、推断和未解决缺口 |
| `pnpm exec nimicoding validate-spec-governance --profile nimi --scope {scope}` | 验证配置的治理范围 |
| `pnpm exec nimicoding classify-spec-tree --profile nimi --root .nimi/spec [--json]` | 分类规范条目 |
| `pnpm exec nimicoding validate-placement --profile nimi --root .nimi/spec [--json]` | 验证 placement contracts |
| `pnpm exec nimicoding validate-table-family --profile nimi --root .nimi/spec [--json]` | 验证 table-family contracts |
| `pnpm exec nimicoding validate-projection-edges --profile nimi --root .nimi/spec [--json]` | 验证 projection edges |
| `pnpm exec nimicoding validate-guidance-bodies --profile nimi --root .nimi/spec [--json]` | 验证 guidance bodies |
| `pnpm exec nimicoding validate-domain-admission --profile nimi --root .nimi/spec [--json]` | 验证 domain admission records |
| `pnpm exec nimicoding validate-tracked-output-admission --profile nimi --root .nimi/spec [--json]` | 验证 tracked-output admission |
| `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope {scope} --check` | 检查 derived docs |
| `pnpm exec nimicoding validate-ai-governance --profile nimi --scope {scope}` | 验证 AI 治理约束 |
| `pnpm exec nimicoding blueprint-audit [--blueprint-root {path}] [--canonical-root {path}] [--json] [--write-local]` | 比较 blueprint 与 canonical spec roots |

## Skill Contracts

宿主直接读取这些声明：

| Skill | Result contract |
| --- | --- |
| `spec_reconstruction` | `.nimi/contracts/spec-reconstruction-result.yaml` |
| `doc_spec_audit` | `.nimi/contracts/doc-spec-audit-result.yaml` |
| `audit_sweep` | `.nimi/contracts/audit-sweep-result.yaml` |

## 高风险证据

`.nimi/contracts/high-risk-admission.schema.yaml` 定义本地静态准入证据。高风险任务的
执行与完成属于宿主状态，Nimi 不提供对应命令族。

## 来源依据

- [`config/nimicoding-host-hardcut.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/nimicoding-host-hardcut.yaml)
- [`.nimi/config/skill-manifest.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/skill-manifest.yaml)
- [`.nimi/contracts/high-risk-admission.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/high-risk-admission.schema.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
