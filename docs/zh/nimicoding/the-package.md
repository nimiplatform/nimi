# 软件包

`@nimiplatform/nimi-coding` 是独立软件包。它把 Nimi Coding 方法论与契约投影到
宿主仓库，并提供确定性 CLI 检查。

## Nimi 准入表面

在 Nimi 仓库中，这个包被准入用于：

- Retained host-owned `.nimi/config/**`、`.nimi/contracts/**` 与 `.nimi/methodology/**` 投影集合；
- 经过 compatibility wrapper 的 projection 与 doctor 检查；
- 外部宿主 skill 声明与 result contracts；
- 规范重建与治理验证；
- Authority preflight 与静态/本地高风险证据；
- prompt、结果与 acceptance 的确定性验证。

项目持有 `.nimi/spec/**`。`.nimi/local/**` 下的本地证据用于复核，不能自行提升为
语义真相。

## 执行上限

软件包不持有 Nimi 的任务计划、进度、委派、重试、等待、恢复或完成状态。它不启动
嵌套宿主，也不选择宿主下一步。Codex App 或其他已准入外部宿主端到端持有这些能力。

## 软件包与项目所有权

| 表面 | Owner |
| --- | --- |
| 软件包源码与发布 | `@nimiplatform/nimi-coding` 仓库 |
| Retained 项目投影 | Nimi host，受准入契约约束 |
| 产品权威 | Nimi `.nimi/spec/**` |
| 项目检查 | Nimi scripts 与已准入 package validators |
| 任务执行 | 当前外部宿主 |
| 本地证据 | 项目本地，非语义真相 |

## 来源依据

- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi-coding/blob/main/package.json)
- [`config/nimicoding-host-hardcut.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/nimicoding-host-hardcut.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/host-adapter.yaml)
