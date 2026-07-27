# Nimi Coding 命令表面

Nimi 通过宿主边界使用 `@nimiplatform/nimi-coding` 0.3.1。项目命令负责核验软件包
和受管文件，包内命令负责规范构建与治理检查；规划和执行始终归 AI 宿主。

准确语法见[参考 → CLI Commands](/zh/nimicoding/reference/cli-commands)。

## 支持类别

| 类别 | Nimi 表面 |
| --- | --- |
| 受管文件一致性 | `pnpm check:nimi-coding-seed-sync` |
| Package doctor | `pnpm nimicoding:doctor` |
| 规范验证 | `validate-spec-tree`、`validate-spec-audit`、`validate-spec-governance` |
| 派生文档验证 | `generate-spec-derived-docs --check` |
| AI 治理验证 | `validate-ai-governance` |
| 规范结构 | `classify-spec-tree`、`validate-placement`、`validate-table-family`、`validate-projection-edges`、`validate-guidance-bodies`、`validate-domain-admission`、`validate-tracked-output-admission`、`blueprint-audit` |

## 验证 Host 边界

```bash
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

宿主边界本身由 `.nimi/spec/platform/authority-admission.authority.yaml` 中的
`P-PKG-011` 声明：即使安装包内仍带有 topic 生命周期、wave/packet 执行 DAG、
run ledger、goal bridge 或嵌套宿主启动，这些执行面一律不予准入。sync 与 doctor
按软件包当前的投影策略核验受管文件，但不负责写入。

## 验证产品真相

```bash
pnpm exec nimicoding validate-spec-tree .nimi/spec
pnpm exec nimicoding validate-spec-audit
pnpm exec nimicoding validate-spec-governance --profile nimi --scope <scope>
pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope <scope> --check
pnpm exec nimicoding validate-ai-governance --profile nimi --scope <scope>
```

使用仓库声明的受影响范围。变更跨越权威边界时，必须补充广范围验证。

## 构建与审计规范树

`.nimi/methodology/spec-reconstruction.yaml` 定义构建规则，
`.nimi/config/spec-generation-inputs.yaml` 声明 Nimi 的输入，
`.nimi/contracts/spec-generation-audit.schema.yaml` 约束本地生成证据。
这些文件只约束产物，不创建任务、不选择执行者，也不运行审计流程。

## 高风险工作

高风险工作遵循仓库的 authority preflight、受影响的确定性门禁与真实 runtime
验收。Nimi Coding 不持有高风险任务状态，也不提供任务执行命令族。

## 边界汇总

| 事项 | Owner |
| --- | --- |
| 任务、计划、子代理、重试、恢复、完成 | Codex 或其他已准入宿主 |
| 产品权威 | `.nimi/spec/**` |
| 方法论与证据契约 | `.nimi/methodology/**` 与 `.nimi/contracts/**` |
| 确定性验证 | 项目 wrappers 与已准入 package validators |
| Runtime 与 UI 验收 | 由宿主发起的真实 app/runtime 检查 |

## 来源依据

- [`.nimi/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/spec-reconstruction.yaml)
- [`.nimi/contracts/spec-generation-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-generation-audit.schema.yaml)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
