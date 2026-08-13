# Nimi Coding Host 集成

Nimi workspace 将 `@nimiplatform/nimi-coding@0.6.1` 固定为精确的
development dependency。正常安装 workspace 后即可使用 CLI：

```bash
pnpm install
```

直接调用 CLI 时，应在仓库根目录使用 `pnpm exec nimicoding ...`，以便解析
workspace 精确固定的本地软件包。不要探测或依赖全局 `PATH` 中的
`nimicoding`。

## 验证受管集成

```bash
pnpm nimicoding:sync
pnpm nimicoding:doctor
```

本仓库中的 `nimicoding:sync` 执行 `sync --check`；它只核验受管文件，不会
改写产品 authority 或宿主任务状态。`nimicoding:doctor` 检查软件包与受管
内容是否兼容。两个命令都不会验证 authority corpus、实现一致性或任务是否
可以开始。

`nimicoding start` 用于新仓库的首次接入。它只创建文档明确列出的 authoring
guide、受管 instruction block 和被忽略的 `.nimi/local/` 根目录，不会创建
产品 authority、注册任务 hook 或安装强制前置检查。当前 Nimi checkout 已经
完成接入，日常工作使用上面的 `sync` 与 `doctor` 脚本即可。

`AGENTS.md` 与 `CLAUDE.md` 的受管区块向 AI 宿主说明可用的有界命令和声明
边界。它们不是执行 wrapper。`start` 与 `sync` 只拥有明确登记的受管路径和
带标记区块。

## 代码读取

当前 0.6.1 依赖提供 `code context`，用于读取有界的 TypeScript/TSX outbound
context；`code authority` 用于查询 TypeScript、TSX、Go、Python 和 Rust 源码中
可选的精确物理行标记。标记查询不证明语言注释语境；两个命令都不会评价未标注
实现，也不证明实现符合 authority。

## 验证产品 Authority

```bash
pnpm spec:authority:check
pnpm spec:authority:compile
pnpm spec:authority:audit
```

修改 authority 时，必须遵守 `.nimi/methodology/authority-authoring.yaml`：
先获取有界 context，使用带显式 budget 的 semantic diff 与 impact，逐个格式化
changed authority file，最后检查完整 `.nimi/spec` 输入集。

Configured audit 只评价 `.nimi/config/authority-verifiers.yaml` 中的显式绑定；
blocking clear 不表示业务语义完备或 implementation conformance 已通过。

## 文件位置

Nimi Coding host configuration 放在 `.nimi/config/**`。受管 authoring guide
继续放在 `.nimi/methodology/**`。根 `config/**` 适合产品 schema、生成器输入
和实现侧内容；引用 canonical authority ID 不会让它变成 Nimi Coding 配置，也不
会让它成为第二套 authority。

## 来源依据

- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
- [`.nimi/methodology/authority-authoring.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-authoring.yaml)
