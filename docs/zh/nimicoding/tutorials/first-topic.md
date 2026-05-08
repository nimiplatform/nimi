# 教程：首个 Topic 引导

本教程带你在一个新项目里完成 Nimi Coding 引导，把 `.nimi/**` 接好。完成后你会拥有：

- 安装好的 `@nimiplatform/nimi-coding`
- 写入了包自有 bootstrap source 的 `.nimi/**`
- `AGENTS.md` / `CLAUDE.md` 中受管的 AI 区块，确认引导已就绪
- 一份针对 `spec_reconstruction` 的权威 JSON 交接 payload

## 前置要求

| 要求 | 原因 |
| --- | --- |
| Node.js 24 或更新 | 包跑在 Node 上 |
| 受版本管理的项目根 | 引导会创建文件，你需要复核 |
| 一个已准入的外部 AI 宿主 | 下一步 `spec_reconstruction` 用 |

本教程不要求 spec 已重建——那是引导后的下一步。

## Step 1：安装包

把 `@nimiplatform/nimi-coding` 装为 dev dependency：

```bash
npm install --save-dev @nimiplatform/nimi-coding
```

或：

```bash
pnpm add -D @nimiplatform/nimi-coding
```

不同包管理器命令略有不同，结果相同：项目里能用 `nimicoding` CLI。

安装完成后，`npx nimicoding --help` 能打印帮助文本。

## Step 2：跑 `nimicoding start`

`nimicoding start` 是引导入口。它是**交互式**的：每一步都先解释、再确认、再应用。

CLI 会带你走完：

1. 侦测项目状态。
2. 确认或接受受管 AI 入口（`AGENTS.md`、`CLAUDE.md` 区块）。
3. 把包内 source 投射到项目路径。
4. 写入 `.nimi/spec/_meta` 和 bootstrap 文件 seed。
5. 更新 `.gitignore`，覆盖本地 runtime 状态。
6. 准备一份 `spec_reconstruction` 的 JSON 交接 payload。
7. 在终端里直接打印可粘贴的提示词。

这一步完成后，项目根有：

| 路径 | 内容 |
| --- | --- |
| `.nimi/methodology/` | 方法学 source（policies） |
| `.nimi/contracts/` | Schema source |
| `.nimi/config/` | Bootstrap 配置 |
| `.nimi/spec/_meta/` | 规范生成元数据 seed |
| `AGENTS.md`（或其中区块） | 受管 Nimi Coding 区块 |
| `CLAUDE.md`（或其中区块） | 受管 Nimi Coding 区块 |
| `.gitignore` | 已加上本地状态忽略规则 |

## Step 3：用 `nimicoding doctor` 校验

`nimicoding doctor` 校验引导是否处于健康状态。

它检查：

- `.nimi/**` bootstrap seed 是否就位
- `.nimi/local/`、`.nimi/cache/` 是否存在并保持忽略
- Bootstrap 契约的兼容性元数据
- 跨契约引用是否一致
- Host-adapter 边界真相
- 技能 result-contract 的对齐
- 交接 context 顺序是否就绪

doctor 输出健康，意味着你可以把技能交接给外部 AI 宿主了。

如果有黄/红警告，报告会指出问题位置；处理后再跑一次。

## Step 4：检查生成的交接 payload

`nimicoding start` 已经为 `spec_reconstruction` 生成了 JSON 交接 payload。文件位于 `.nimi/local/handoff/`（或 CLI 输出里指明的路径）。

打开这个 JSON，注意：

- `skill: "spec_reconstruction"`
- 一个有必备 context 顺序的强类型 payload
- 宿主应当读取的 source basis 路径

这份 payload 就是包与宿主之间的契约。

## Step 5：到此为止

你已经完成了引导。项目现已接入 Nimi Coding。下一步（在 [首个 Wave 端到端](/zh/nimicoding/tutorials/first-wave-end-to-end) 中）才是真正跑一个 wave。

本教程**就停在这里**。先不要把 payload 交给宿主，也先不要跑重建。引导完成本身就是本教程的目标。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `nimicoding start` 报已有文件冲突 | 复核冲突；CLI 保留项目自有真相，拒绝覆写 |
| `nimicoding doctor` 报告生命周期漂移 | 再跑一次 `start`；引导是幂等的 |
| AGENTS.md 改动未应用 | CLI 弹了确认框；如果你拒绝过，重跑并确认 |

## 现在你拥有什么

教程结束后，你的项目有：

- 完整的 `.nimi/**` 引导。
- 受管的 AI 入口（在 `AGENTS.md` 与 `CLAUDE.md` 中）。
- 一份准备好的 `spec_reconstruction` 交接 payload。

你**还没有**：

- 已重建的权威规范树（下一步）。
- 任何 topic / wave / packet 工件（按需在后续创建）。
- 受治理的 AI 编码工作（你拥有了纪律框架，但还没有任务进行中）。

## 下一步

如果想在样例任务上真正用一遍方法学，继续看 [首个 Wave 端到端](/zh/nimicoding/tutorials/first-wave-end-to-end)。

## 本教程不涉及

本教程不覆盖具体宿主的特定配置。包是宿主无关的，你可以选任何已准入的宿主。

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/)（CLI 实现）
- [`nimi-coding/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/spec-reconstruction.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
