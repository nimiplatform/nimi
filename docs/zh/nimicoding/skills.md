# Skills

Nimi Coding skill 是强类型 handoff 契约。它告诉已准入外部宿主需要读取哪些权威、
返回什么结果形态，以及哪些 validators 构成证据。它不会在仓库里创建第二项任务或
执行引擎。

## 已声明的 Skills

| Skill | 用途 | 长期结果 |
| --- | --- | --- |
| `spec_reconstruction` | 根据仓库证据重建 canonical authority | `.nimi/spec/**` 与本地重建审计 |
| `doc_spec_audit` | 比较文档主张与 active authority | 本地 drift findings |
| `audit_sweep` | 根据明确标准检查声明的源码范围 | 本地 findings 与证据 |

## 宿主边界

当前 Codex 任务直接从 `.nimi/config/skill-manifest.yaml` 选择 skill 声明，按必备
context 顺序读取 inputs，使用原生计划与子代理完成工作，再返回指定 result-contract
形态。

## 结果边界

`.nimi/config/skill-manifest.yaml` 中的每个 skill 都指定 result contract。外部宿主
返回对应形态，项目 validators 负责检查，运行证据始终保持 local-only。结果工件
不会把 Codex 任务标记为完成，也不能自行变成产品权威。

## Handoff 内容

Handoff 声明所选 skill、result contract、context 顺序、硬约束、预期结果和 readiness。
Codex 决定执行机制。确定性 validators 检查结构契约是否满足；语义判断仍归
authority owner。

## 来源依据

- [`.nimi/config/skills.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/skills.yaml)
- [`.nimi/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/skill-handoff.yaml)
- [`.nimi/contracts/spec-reconstruction-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-reconstruction-result.yaml)
- [`.nimi/contracts/doc-spec-audit-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/doc-spec-audit-result.yaml)
- [`.nimi/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/prompt.schema.yaml)
- [`.nimi/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/worker-output.schema.yaml)
