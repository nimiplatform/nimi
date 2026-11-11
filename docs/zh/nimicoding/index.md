<!-- nimi-docs: {"authority":[],"sources":["package.json",".nimi/methodology/authority-authoring.yaml","scripts/check-docs-source.mjs","scripts/lib/docs-source.mjs","scripts/detect-ci-scope.mjs"]} -->

# Nimi Coding

Nimi Coding 为 AI 宿主环境与工程工具链提供确定性的规范权威（Canonical Authority）检索与校验能力。它负责规范文件的格式化、静态结构校验、关系图谱查询、依赖导航与变更影响审查；其定位是专注的底层规范效能工具，而非自主决策的 AI Agent、代码生成器或产品设计生成器。

本章节基于当前工作区精确锁定的 `@nimiplatform/nimi-coding@0.7.0` 版本编写。具体 CLI 指令细节与参数请以软件包随附的 README 与终端输出为准。

## 规范与配置边界划分

| 文件路径模式 | 核心定位与职责 |
| --- | --- |
| `.nimi/spec/**/*.authority.{yaml,md}` | 全局唯一的平台级规范权威来源 (Canonical Product Authority) |
| `.nimi/config/**` | 仓库自有的 Nimi Coding 宿主运行配置 |
| `.nimi/methodology/authority-authoring.yaml` | 权威规范编写与维护的官方指导方法论 |
| `.nimi/local/**` | 本地测试产物与校验缓存（已被 Git 忽略，绝不作为权威依据） |
| `config/**` | 应用、代码生成器与宿主实现的静态输入，不属于 Nimi Coding 内部配置 |

Nimi Coding 保持严格的单一真实源（Single Source of Truth）：任何下游生成的开发文档、测试用例、临时构建产物或审计报告，均不得反向定义或修改权威规范。

## 边界清晰的代码上下文检索

- **`code context`**：从指定的 TypeScript / TSX 源码文件、合规声明的顶层符号（不要求导出）与 `tsconfig` 中，即时分析并提取有界的向外静态依赖上下文（Outbound Context）。
- **`code authority`**：在 Git 纳管的 TypeScript、TSX、Go、Python 与 Rust 代码中，精确扫描按物理行声明的 `@nimi-authority` 或 `@nimi-deprecated` 规范锚点，亦支持从单个源文件反查其绑定的规范条目。

上述两项指令均为纯只读操作，且完全遵循按需调用原则：它们不作为强制的前置流水线门禁，不变更任务生命周期，亦不会对未标记的代码进行推断或评价。

## 规范变更与维护工作流

1. **有界检索**：在尚未明确具体规范 ID 时，先通过 `authority discover` 进行有界发现，再由维护者锁定目标条目。
2. **提取上下文**：在动手修改规范前，先通过 `authority context` 读取该条目的完整声明依赖。
3. **格式化与校验**：修改完成后，逐一使用 `authority fmt` 格式化规范文件，并运行 `authority check` 针对全局规范集执行完整性校验。
4. **影响分析**：使用显式限制字节预算的 `authority diff` 与 `authority impact` 审查变更影响范围。
5. **重构候选排查**：在涉及深层重构时，通过 `authority change-candidates` 检索受影响候选集；该命令仅作为线索召回，不代替人工语义评审。

项目根目录的 `AGENTS.md` 与 `.nimi/methodology/authority-authoring.yaml` 定义了详细的规范编写守则。

## 延伸阅读

- [宿主环境集成](/zh/nimicoding/installation)
- [CLI 命令参考速查](/zh/nimicoding/cli-reference)

## 文档消费者复核

本仓库的 `pnpm check:docs-source` 检查 Source Basis 路径、代码引用以及试点页的精确 authority ID。页面中的 `nimi-docs` JSON 注释只记录引用；格式见 `docs/AGENTS.md`。CI 根据这些引用列出候选页面并触发文档检查，不要求先升级 Nimi Coding。

需要查看某个提交之后的候选页面时，给仓库脚本传入 `--changed-from` 和完整的 40 位提交 SHA。它按 authority 文件和源码路径保守选择，不能证明具体语义已同步。`authority diff`、`impact`、`review` 与读者路径核对各自保留原有职责。

## Source Basis

- [`nimi-coding/README.zh-CN.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.zh-CN.md)
- [`.nimi/methodology/authority-authoring.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-authoring.yaml)
