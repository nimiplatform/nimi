# Nimi Coding 宿主环境集成

Nimi 工作区将 `@nimiplatform/nimi-coding@0.7.0` 作为严格锁定的开发依赖进行管理。在完成工作区初始化后即可直接调用其 CLI 工具：

```bash
pnpm install
```

在终端直接执行命令时，建议在仓库根目录下运行 `pnpm exec nimicoding ...`，以确保精确使用工作区本地锁定的版本。请勿依赖操作系统全局 `PATH` 中的 `nimicoding` 可执行文件。

## 验证受管集成状态

```bash
pnpm nimicoding:sync
pnpm nimicoding:doctor
```

- `pnpm nimicoding:sync`：在底层执行 `sync --check`，校验受管模板与配置文件的同步状态，不会擅自改写权威规范或宿主任务状态。
- `pnpm nimicoding:doctor`：检查本地安装的包版本与受管规范结构之间的运行时兼容性。

针对全新的空仓库，`nimicoding start` 可用于引导初始化基础模板（生成标准规范目录与 `.nimi/local/` 缓存目录）。当前 Nimi 仓库已经过完整初始化，日常维护使用上述 `sync` 与 `doctor` 脚本即可。

`AGENTS.md` 与 `CLAUDE.md` 中的受管注释区块用于告知 AI 宿主当前可用的合规指令与权限边界，它们属于指导性规范，而非侵入式的强制执行包装器。

## 源码上下文与规范标记扫描

当前 0.7.0 版本提供了两个核心代码分析命令：
- **`code context`**：按需提取 TypeScript / TSX 文件向外引用的有界静态依赖上下文。
- **`code authority`**：扫描 TypeScript、TSX、Go、Python 与 Rust 代码中显式声明的 `@nimi-authority` 或 `@nimi-deprecated` 物理行标记（扫描器不判断其语法上下文）。该扫描属于轻量级静态匹配，不会对未标记的代码进行推断或评价。

## 规范有效性校验

```bash
pnpm spec:authority:check
pnpm spec:authority:compile
pnpm spec:authority:audit
```

在日常修改权威规范时，请严格遵守 `.nimi/methodology/authority-authoring.yaml` 中的流程指引：
1. 提取有界上下文。
2. 执行带有合理字节预算的语义差量与影响分析。
3. 针对修改过的规范容器文件执行 `authority fmt` 格式化。
4. 运行 `authority check` 针对完整规范集进行整体校验。

## 配置与目录划分

- **`.nimi/config/**`**：存放 Nimi Coding 专属的宿主配置文件。
- **`.nimi/methodology/**`**：存放受管的规范编写方法论文档。
- **根目录 `config/**`**：存放具体的业务产品配置、代码生成器输入与系统静态字典；在其中引用规范 ID 仅作为语义追溯，并不会将其变成第二套权威规范。

## Source Basis

- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
- [`.nimi/methodology/authority-authoring.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-authoring.yaml)
