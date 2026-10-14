# Nimi Coding CLI 命令参考

`nimicoding` CLI 是 Nimi Coding 的标准调用入口。在脚本或自动化流程中调用时，请同时检查命令退出码与返回的 JSON 结构化数据：空结果仅表示在其限定查询边界内未命中任何条目，并不代表对代码正确性、规范合规性或范围外情况的评价。

在仓库根目录下通过 `pnpm exec nimicoding ...` 调用工作区本地锁定的版本。为简洁起见，下表中省略 `pnpm exec nimicoding` 前缀。

## 命令速查表

| 功能分类 | 常用命令 |
| --- | --- |
| 规范编写与格式化 | `authority fmt`、`authority check`、`authority compile` |
| 仓库使用与引用分析 | `authority anchors`、`authority consumers`、`authority terms`、`authority closed-sets` |
| 规范定位与上下文读取 | `authority discover`、`authority query`、`authority context` |
| 拓扑关系与路径导航 | `authority refs`、`authority path`、`authority subgraph` |
| 变更差异与影响审查 | `authority diff`、`authority change-candidates`、`authority impact`、`authority audit`、`authority review` |
| 静态源码上下文分析 (0.6+) | `code context` |
| 显式代码与规范关联查询 (0.6.1+) | `code authority` |
| 仓库受管配置维护 | `start`、`sync`、`doctor`、`clear` |

## 关键参数与调用约束

- **显式预算限制**：带有范围约束的命令强制要求传入正整数预算参数（如 `--max-units`、`--max-edges`、`--max-bytes`）。当实际匹配结果超出预算时，命令将直接报错拒绝（fail closed），绝不返回具有误导性的截断结果。
- **候选召回 (`change-candidates`)**：基于调用方指定的检索通道返回确定性的相关候选条目，不进行主观的语义裁决。
- **静态代码上下文 (`code context`)**：接收指定的 TypeScript 或 TSX 源码文件、顶层符号、`tsconfig` 路径及字节预算，返回该符号向外的直接静态引用，不涵盖运行时动态派发。
- **规范标记扫描 (`code authority`)**：扫描源码中显式声明的保留物理行标记：
  - TypeScript、TSX、Go 与 Rust：
    ```text
    // @nimi-authority: <exact-authority-id>
    // @nimi-deprecated: <exact-authority-id>
    ```
  - Python：
    ```text
    # @nimi-authority: <exact-authority-id>
    # @nimi-deprecated: <exact-authority-id>
    ```
  - 标记扫描采用精确的逐行文本匹配。标记应审慎标注于关键领域归属模块（Domain Owner），避免散落标注在常规辅助函数或测试文件中。
- **受管工具维护**：`start`、`sync` 与 `doctor` 仅用于维护受管配置与环境健康度，不拦截正常开发流程，亦不会干预 AI 任务状态。

## Source Basis

- [`nimi-coding/README.zh-CN.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.zh-CN.md)
- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
