# Nimi Coding 命令表面

Nimi 通过 host hardcut 消费 `@nimiplatform/nimi-coding`。项目 wrappers 暴露健康度
与投影检查，已准入 package validators 检查规范和治理；任务执行归 Codex。

准确语法见[参考 → CLI Commands](/zh/nimicoding/reference/cli-commands)。

## 支持类别

| 类别 | Nimi 表面 |
| --- | --- |
| Host hardcut | `pnpm check:nimicoding-host-hardcut` |
| Package projection 检查 | `pnpm check:nimi-coding-seed-sync` |
| Compatibility doctor | `pnpm nimicoding:doctor` |
| Skill 声明 | `.nimi/config/skill-manifest.yaml` |
| 规范验证 | `validate-spec-tree`、`validate-spec-audit`、`validate-spec-governance` |
| 派生文档验证 | `generate-spec-derived-docs --check` |
| AI 治理验证 | `validate-ai-governance` |
| 规范结构 | `classify-spec-tree`、`validate-placement`、`validate-table-family`、`validate-projection-edges`、`validate-guidance-bodies`、`validate-domain-admission`、`validate-tracked-output-admission`、`blueprint-audit` |

## 验证 Host 边界

```bash
pnpm check:nimicoding-host-hardcut
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

Wrappers 强制执行 forbidden projection 集合与已准入 host-owned override 集合。
通用 package mutation 无法作出这项判断。

## 验证产品真相

```bash
pnpm exec nimicoding validate-spec-tree .nimi/spec
pnpm exec nimicoding validate-spec-audit
pnpm exec nimicoding validate-spec-governance --profile nimi --scope <scope>
pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope <scope> --check
pnpm exec nimicoding validate-ai-governance --profile nimi --scope <scope>
```

使用仓库声明的受影响范围。变更跨越权威边界时，必须补充广范围验证。

## Skills

当前宿主直接读取 `.nimi/config/skill-manifest.yaml` 和其中引用的 context。保留的
skills 是 `spec_reconstruction`、`doc_spec_audit` 与 `audit_sweep`。Result contracts
留在项目中；宿主自行规划并执行工作。

## 高风险工作

高风险工作使用 authority preflight、`.nimi/contracts/high-risk-admission.schema.yaml`
中的静态/本地证据契约、受影响 validators 与真实 runtime 验收。Nimi 不提供对应的
执行命令族。

## 边界汇总

| 事项 | Owner |
| --- | --- |
| 任务、计划、子代理、重试、恢复、完成 | Codex 或其他已准入宿主 |
| 产品权威 | `.nimi/spec/**` |
| 方法论与证据契约 | `.nimi/methodology/**` 与 `.nimi/contracts/**` |
| 确定性验证 | 项目 wrappers 与已准入 package validators |
| Runtime 与 UI 验收 | 由宿主发起的真实 app/runtime 检查 |

## 来源依据

- [`config/nimicoding-host-hardcut.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/nimicoding-host-hardcut.yaml)
- [`.nimi/config/skill-manifest.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/skill-manifest.yaml)
- [`.nimi/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/skill-handoff.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
