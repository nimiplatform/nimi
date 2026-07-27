# 教程：验证 Nimi 治理设置

本教程验证 Nimi 仓库中 Codex 与 Nimi Coding 的边界。完成后，你能确认宿主执行
所有权、项目真相与软件包受管文件已对齐。

## 前置要求

- Nimi 源码 checkout。
- Node.js 24 或更新版本，以及 pnpm。
- 当前 Codex 任务或其他已准入外部宿主。

## 1. 安装 Workspace

```bash
pnpm install
```

仓库已经包含准入后的 `.nimi/**` projections，不需要 package bootstrap 命令。

## 2. 了解宿主边界

`.nimi/spec/platform/authority-admission.authority.yaml` 中的 `P-PKG-011` 声明：
执行权归 Codex，项目侧的执行投影（topic 生命周期、wave/packet DAG、run ledger、
goal bridge、嵌套宿主启动）一律不予准入。该边界没有单独的门禁命令可跑；仓库以
确定性方式执法的是第 3 步的受管文件与 doctor 检查。

## 3. 验证受管文件

```bash
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

package-canonical 文件缺失或漂移时，两条命令都会失败，但不会恢复任何执行状态。

## 4. 检查规范构建契约

打开下列文件：

| 文件 | 职责 |
| --- | --- |
| `.nimi/config/spec-generation-inputs.yaml` | Nimi 专用、已分类的构建输入 |
| `.nimi/methodology/spec-reconstruction.yaml` | 构建目标与门禁 |
| `.nimi/contracts/spec-generation-audit.schema.yaml` | 文件级来源与未解决缺口 |
| `.nimi/contracts/spec-layout.schema.yaml` | 宿主指令和受管生成目录的布局 |

当前 Codex 任务直接读取这些约束。计划、子代理、进度和完成状态始终留在 Codex。

## 5. 验证 Canonical Authority

```bash
pnpm exec nimicoding validate-spec-tree .nimi/spec
```

检查通过说明结构契约成立。规范构建修改了 canonical 文件时，还要运行
`pnpm exec nimicoding validate-spec-audit`，并确保本地生成审计存在且完整。产品判断
仍由 `.nimi/spec/**` 中的 canonical owner 决定。

## 最终状态

| 表面 | 状态 |
| --- | --- |
| Codex | 唯一任务执行者 |
| `.nimi/spec/**` | 项目规范真相 |
| `.nimi/methodology/**` | 保留的治理规则 |
| `.nimi/contracts/**` | 保留的 validators 与证据形态 |
| 项目命令 | 边界与内容漂移检查 |

继续阅读[用 Codex 开展受治理开发](/zh/nimicoding/tutorials/project-to-governed-execution)，
把这条边界用于真实变更。

## 来源依据

- [`.nimi/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/spec-reconstruction.yaml)
- [`.nimi/contracts/spec-generation-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-generation-audit.schema.yaml)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
