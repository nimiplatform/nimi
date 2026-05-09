# Nimi Coding 安装

Nimi Coding 以公开 npm 包 `@nimiplatform/nimi-coding` 的形式分发。在你想要 `.nimi/**` 治理层和 `nimicoding` CLI 的项目里安装它即可。

## 前置要求

| 要求 | 说明 |
| --- | --- |
| Node.js | 24 或更新版本 |
| 包管理器 | npm、pnpm、yarn 或任何能装 npm 包的工具 |
| 项目根目录 | 建议在受版本管理的项目里使用，因为 `start` 会创建文件 |

## 安装

按项目使用的包管理器执行：

```bash
npm install --save-dev @nimiplatform/nimi-coding
```

或：

```bash
pnpm add -D @nimiplatform/nimi-coding
```

安装完成后，包管理器应该已经把 `nimicoding` 二进制暴露给项目：

```bash
npx nimicoding --version
npx nimicoding --help
```

## 引导

在项目根目录执行 `start`：

```bash
npx nimicoding start
```

需要做非交互式冒烟测试时，用：

```bash
npx nimicoding start --yes
npx nimicoding doctor --json
```

`start` 会创建或更新 `.nimi/**` 下的包自有 bootstrap 层，在你确认时追加受管 AI 入口区块，并准备下一次交接的 payload。它不会动项目自有的真相：`.nimi/spec/**`、`.nimi/local/**`、`.nimi/cache/**`、本地修改过的 bootstrap 文件都会被原样保留，不会被静默删除或覆盖。

## 首次检查

| 检查 | 期望结果 |
| --- | --- |
| `nimicoding --version` | 打印已安装的包版本 |
| `nimicoding --help` | 列出 bootstrap、topic、sweep audit、sweep design、handoff、closeout 与校验器命令 |
| `nimicoding doctor --json` | 以机器可读形态报告 bootstrap 健康度 |

## 移除包管理的 bootstrap

如果需要从测试项目里清掉包管理的 bootstrap 文件，运行：

```bash
npx nimicoding clear --yes
```

`clear` 只在受管 AI 区块和包自有 bootstrap 文件仍与发布 seed 一致时才会移除它们。项目自有真相和本地操作证据不在它的清理范围内。

## 来源依据

- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/package.json)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/)
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/topic.schema.yaml)
