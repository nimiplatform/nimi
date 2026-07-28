# Nimi Coding

Nimi Coding 为 AI 宿主和仓库工具提供确定性的 project-owned canonical
authority 访问能力。它负责格式化、检查、查询、关系导航与变更审查；它不是
AI Agent、规划器、代码生成器、审批流程或产品规范生成器。

本页是当前固定版本 `@nimiplatform/nimi-coding` 的说明性投影。命令行为以
软件包 CLI 和软件包内 README 为操作参考。

## Truth 边界

| 路径 | 作用 |
| --- | --- |
| `.nimi/spec/**/*.authority.{yaml,md}` | 唯一 canonical product authority |
| `.nimi/config/**` | 仓库自有的 Nimi Coding host configuration |
| `.nimi/methodology/authority-authoring.yaml` | 受管的 authority 编写说明 |
| `.nimi/local/**` | 被忽略的本地诊断与派生证据，永远不是 authority |
| `config/**` | 产品、生成器和宿主实现输入，不是 Nimi Coding host configuration |

Nimi Coding 不会把文档、fixture、生成物、审计结果或 `config/**` 投影变成
产品 authority。

## 当前流程

尚不知道精确 authority ID 时，先做有界 discovery，再依据项目或 owner
证据选择精确单元。修改前获取其声明的 context；修改后逐文件格式化，对完整
authority 根执行检查，并使用带显式 byte budget 的 semantic diff 与 impact。

仓库的 `AGENTS.md` 与 `.nimi/methodology/authority-authoring.yaml` 定义
具体 authoring 流程。Nimi Coding 不拥有宿主任务生命周期。

## 继续阅读

- [Host 集成](/zh/nimicoding/installation)
- [CLI 参考](/zh/nimicoding/cli-reference)

## 来源依据

- [`@nimiplatform/nimi-coding` README](https://github.com/nimiplatform/nimi-coding/blob/main/README.zh-CN.md)
- [`.nimi/methodology/authority-authoring.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-authoring.yaml)
