# 教程：验证 Nimi 治理设置

本教程验证 Nimi 仓库中 Codex 与 Nimi Coding 的边界。完成后，你能确认宿主执行
所有权、项目真相、package projections 与 retained skills 已对齐。

## 前置要求

- Nimi 源码 checkout。
- Node.js 24 或更新版本，以及 pnpm。
- 当前 Codex 任务或其他已准入外部宿主。

## 1. 安装 Workspace

```bash
pnpm install
```

仓库已经包含准入后的 `.nimi/**` projections，不需要 package bootstrap 命令。

## 2. 验证 Hardcut

```bash
pnpm check:nimicoding-host-hardcut
```

该检查确认 Codex 持有执行权，并确保项目侧禁用执行投影保持缺失。

## 3. 验证 Projection Compatibility

```bash
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

两条命令都经过 Nimi compatibility policy。出现意外 drift 时会失败，不会恢复
package-owned 执行状态。

## 4. 检查 Retained Skills

打开 `.nimi/config/skill-manifest.yaml`，其中声明：

| Skill | Result contract |
| --- | --- |
| `spec_reconstruction` | `.nimi/contracts/spec-reconstruction-result.yaml` |
| `doc_spec_audit` | `.nimi/contracts/doc-spec-audit-result.yaml` |
| `audit_sweep` | `.nimi/contracts/audit-sweep-result.yaml` |

当前 Codex 任务直接读取所选 skill 的 inputs 与 result contract。计划、子代理、进度
和完成状态始终留在 Codex。

## 5. 验证 Canonical Authority

```bash
pnpm exec nimicoding validate-spec-tree .nimi/spec
```

检查通过说明结构契约成立。当前任务执行过 `spec_reconstruction` 时，还要运行
`pnpm exec nimicoding validate-spec-audit`，并且声明的 audit artifact 必须存在。
产品判断仍由 `.nimi/spec/**` 中的 canonical owner 决定。

## 最终状态

| 表面 | 状态 |
| --- | --- |
| Codex | 唯一任务执行者 |
| `.nimi/spec/**` | 项目规范真相 |
| `.nimi/methodology/**` | 保留的治理规则 |
| `.nimi/contracts/**` | 保留的 validators 与证据形态 |
| 项目 wrappers | Compatibility 与 drift 检查 |

继续阅读[用 Codex 开展受治理开发](/zh/nimicoding/tutorials/project-to-governed-execution)，
把这条边界用于真实变更。

## 来源依据

- [`config/nimicoding-host-hardcut.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/nimicoding-host-hardcut.yaml)
- [`.nimi/config/skill-manifest.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/skill-manifest.yaml)
- [`.nimi/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/skill-handoff.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
