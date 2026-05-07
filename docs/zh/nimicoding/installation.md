# Nimi Coding 安装

Nimi Coding 已经以 npm 包形式公开分发，包名是
`@nimiplatform/nimi-coding`。在你想采纳这套治理方法的项目根目录里安装它，然后用
`nimicoding` CLI 初始化 `.nimi/**`。

## 前置条件

| 条件 | 说明 |
| --- | --- |
| Node.js | 24 或更新版本 |
| 包管理器 | npm、pnpm、yarn，或其他能安装 npm 包的工具 |
| 项目根 | 建议先有版本控制；`start` 会创建文件，方便你 review |

## 安装

按你的项目习惯选择命令：

```bash
npm install --save-dev @nimiplatform/nimi-coding
```

或：

```bash
pnpm add -D @nimiplatform/nimi-coding
```

装完后，在项目里确认 CLI 可用：

```bash
npx nimicoding --version
npx nimicoding --help
```

## 初始化项目

在项目根目录运行：

```bash
npx nimicoding start
```

如果只是想在干净环境里快速验一遍，可以跑非交互命令：

```bash
npx nimicoding start --yes
npx nimicoding doctor --json
```

`start` 会写入包拥有的 bootstrap 层，准备 `.nimi/**`、托管 AI 入口块与下一步 handoff
payload。它不会静默覆盖项目自己的真相：`.nimi/spec/**`、`.nimi/local/**`、
`.nimi/cache/**`，以及被你本地改过的 bootstrap 文件都会被保留。

## 第一轮检查

| 检查 | 预期 |
| --- | --- |
| `nimicoding --version` | 打印已安装版本 |
| `nimicoding --help` | 能看到 bootstrap、topic、sweep audit、sweep design、handoff、closeout、validator 等命令族 |
| `nimicoding doctor --json` | 以机器可读 JSON 报告 bootstrap 健康状态 |

## 清理测试项目

如果你只是在临时目录里试用，测试完可以运行：

```bash
npx nimicoding clear --yes
```

`clear` 只移除托管 AI 块与仍然等同于包种子的 bootstrap 文件。项目自己的规范、运行证据和本地缓存不会被它顺手删掉。

## 来源

- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/package.json)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/)
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/topic.schema.yaml)
