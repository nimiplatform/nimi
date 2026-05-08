# 安装指南 (Installation)

Nimi Coding 是作为一个公开的 npm 包 `@nimiplatform/nimi-coding` 进行分发的。你只需要在你希望建立 `.nimi/**` 治理层的地方（也就是你的项目根目录）安装它，就能瞬间获得 `nimicoding` CLI 工具的加持。

## 环境要求

| 条件 | 备注 |
| --- | --- |
| Node.js | v24 或更新版本 |
| 包管理器 | npm, pnpm, yarn，或者任何能安装 npm 包的现代工具均可 |
| 项目根目录 | 强烈建议在一个已开启版本控制（如 Git）的仓库里运行，因为接下来的 `start` 命令会在目录里创建文件 |

## 安装

使用你顺手的包管理器在项目中进行安装：

```bash
# 使用 npm
npm install --save-dev @nimiplatform/nimi-coding

# 使用 pnpm
pnpm add -D @nimiplatform/nimi-coding
```

安装完毕后，你可以通过包管理器的执行器来确认 `nimicoding` 命令是否已成功挂载：

```bash
npx nimicoding --version
npx nimicoding --help
```

## 初始化引导 (Bootstrap)

在项目的根目录下敲下启动命令：

```bash
npx nimicoding start
```

如果你是在持续集成环境 (CI) 或是需要一键执行，可以使用带有跳过确认标志的非交互模式：

```bash
npx nimicoding start --yes
npx nimicoding doctor --json
```

**`start` 命令到底干了什么？**
它会在你的项目里创建（或更新）一层存放于 `.nimi/**` 目录下、由包全权管理的引导基建。当你授权同意后，它还会帮你往项目里植入用来对接 AI 宿主的接入入口（Entrypoint blocks），并为你接下来的任务交接（Handoff）准备好载荷数据。

**最重要的一点：** 它是绝对克制的。它会誓死保卫属于你自己项目的真相资产——你存放在 `.nimi/spec/**`、`.nimi/local/**`、`.nimi/cache/**` 里的东西，以及被你手动修改过的配置文件，**绝对不会**被它在引导时静悄悄地删掉或覆盖。

## 首轮健康检查

| 检查命令 | 预期的结果 |
| --- | --- |
| `nimicoding --version` | 打印出当前安装的包版本号 |
| `nimicoding --help` | 毫无保留地列出它的所有绝技：bootstrap 引导、topic 治理、扫地式审计 sweep audit、分派交接 handoff、收尾闭合 closeout，以及各式各样的校验器命令 |
| `nimicoding doctor --json` | 给出一份机器可读的 JSON 报告，详细汇报当前引导基建层的健康状况 |

## 卸载并清理包引导的文件

如果你只是在一个沙盒项目里尝尝鲜，想把由包生成的引导文件清理干净，执行：

```bash
npx nimicoding clear --yes
```

**`clear` 命令是极其安全的：** 它只会去抹掉那些被植入的 AI 块代码，以及那些原封不动、完全匹配官方种子文件的引导文件。你在项目里亲手写下的属于你自己的 Spec 真相，以及那些真刀真枪跑出来的执行证据，它连碰都不会碰一下，全部为你保留。

## 来源依据

- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/package.json)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/)
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/topic.schema.yaml)