# Nimi Coding

Nimi Coding 为 AI 宿主和仓库工具提供确定性的 project-owned canonical
authority 访问能力。它负责格式化、检查、查询、关系导航与变更审查；它不是
AI Agent、规划器、代码生成器、审批流程或产品规范生成器。

本页说明 workspace 精确固定的 `@nimiplatform/nimi-coding@0.6.0`。命令行为
以软件包 CLI 和软件包内 README 为操作参考。

## Truth 边界

| 路径 | 作用 |
| --- | --- |
| `.nimi/spec/**/*.authority.{yaml,md}` | 唯一 canonical product authority |
| `.nimi/config/**` | 仓库自有的 Nimi Coding host configuration |
| `.nimi/methodology/authority-authoring.yaml` | 受管的 authority 编写说明 |
| `.nimi/local/**` | 被忽略的本地校验与派生输出，永远不是 authority |
| `config/**` | 产品、生成器和宿主实现输入，不是 Nimi Coding host configuration |

Nimi Coding 不会把文档、fixture、生成物、审计结果或 `config/**` 派生内容变成
产品 authority。

## 有界代码读取

`code context` 从指定的 TypeScript 或 TSX 文件、顶层 symbol 与 tsconfig
即时读取有界的 outbound context。`code authority` 定位 Git 已跟踪的当前
TypeScript、TSX 和 Go 源码中的可选 `nimi-authority`、`nimi-deprecated`
精确标记，也可以从单个源码文件反查这些关联。

两个命令都只处理当前请求，而且只读。是否调用由 AI 宿主决定。它们不会加入
任务前置检查，不会改变宿主任务状态，也不会评价未标注代码或证明实现符合
authority。

## 当前流程

尚不知道精确 authority ID 时，先做有界 discovery，再由项目 authority 或
责任 owner 选择精确单元。修改前获取其声明的 context；修改后逐文件格式化，
对完整 authority 根执行检查，并使用带显式 byte budget 的 semantic diff 与
impact。

如果 redesign 可能在 authored relations 之外留下 unchanged active survivors，
`authority change-candidates` 只召回显式请求的 deterministic channels 的完整
union，不判断 relevance、conflict、retirement 或 conformance。`authority audit`
只评价项目配置的 graph 和 exact lexical bindings；clear 不表示业务语义或实现
对齐已经通过。

仓库的 `AGENTS.md` 与 `.nimi/methodology/authority-authoring.yaml` 定义
具体 authoring 规则。受管文本只为 AI 宿主提供说明，不会拦截 prompt，也不
拥有宿主任务生命周期。

## 继续阅读

- [Host 集成](/zh/nimicoding/installation)
- [CLI 参考](/zh/nimicoding/cli-reference)

## 来源依据

- [`@nimiplatform/nimi-coding` README](https://github.com/nimiplatform/nimi-coding/blob/main/README.zh-CN.md)
- [`.nimi/methodology/authority-authoring.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-authoring.yaml)
