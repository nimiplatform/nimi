# 教程：第一个 Topic Bootstrap

这个教程带你把 Nimi Coding bootstrap 到一个新项目并把 `.nimi/**` 设好。结束时你会有：

- `@nimiplatform/nimi-coding` 已装
- `.nimi/**` 装上包拥有的 bootstrap 源
- 一个托管 `AGENTS.md` / `CLAUDE.md` 块确认 bootstrap
- 一份给 `spec_reconstruction` 的权威 JSON handoff payload

## 前置条件

| 要求 | 为什么 |
| --- | --- |
| Node.js 24 或更新版本 | 包跑在 Node 上 |
| 项目根带版本控制 | Bootstrap 会建新文件；你会想 review |
| 一个 admitted 外部 AI host | 下一步（`spec_reconstruction`）需要 |

教程**不**要求 spec 已经被重建 — 那是 bootstrap 之后的下一步。

## 步骤 1：装包

把 `@nimiplatform/nimi-coding` 装为 dev 依赖：

```bash
npm install --save-dev @nimiplatform/nimi-coding
```

或：

```bash
pnpm add -D @nimiplatform/nimi-coding
```

不同项目可以用不同包管理器；目标一样：让 `nimicoding` 在项目里作为 CLI 可用。

装完后，`npx nimicoding --help` 应打印帮助文本。

## 步骤 2：跑 `nimicoding start`

`nimicoding start` 是 bootstrap 入口。它**交互式**：解释每步、问确认、应用步骤。

CLI 走过：

1. 检测项目状态。
2. 确认或接受托管 AI 入口（`AGENTS.md`、`CLAUDE.md` 块）。
3. 把包源投到项目路径。
4. 种 `.nimi/spec/_meta` 与 bootstrap 文件。
5. 更新 `.gitignore` 给本地 runtime 状态。
6. 准备给 `spec_reconstruction` 的 JSON handoff payload。
7. 在终端直接打印 paste-ready prompt。

这步后，项目根有：

| 路径 | 内容 |
| --- | --- |
| `.nimi/methodology/` | 方法学源（policy） |
| `.nimi/contracts/` | Schema 源 |
| `.nimi/config/` | Bootstrap 配置 |
| `.nimi/spec/_meta/` | Spec 生成元数据种子 |
| `AGENTS.md`（或里面的块） | 托管 Nimi Coding 块 |
| `CLAUDE.md`（或里面的块） | 托管 Nimi Coding 块 |
| `.gitignore` | 加了本地状态 ignore 模式 |

## 步骤 3：用 `nimicoding doctor` 校验

`nimicoding doctor` 校验 bootstrap 是不是健康状态。

它检查：

- `.nimi/**` bootstrap 种子在
- `.nimi/local/` 与 `.nimi/cache/` 在并仍被 ignore
- Bootstrap 合同兼容元数据
- 跨合同引用对齐
- Host-adapter 边界真相
- 技能结果合同对齐
- Handoff context 顺序就绪

健康 doctor 输出确认你能 hand off 技能给外部 AI host。

如果是黄 / 红，报告命名区域；处理被命名的问题再跑一次。

## 步骤 4：检查生成的 handoff payload

`nimicoding start` 产出了给 `spec_reconstruction` 的 JSON handoff payload。文件住在 `.nimi/local/handoff/`（或 CLI 放的位置；CLI 输出命名路径）。

打开 JSON。注意：

- `skill: "spec_reconstruction"`
- 一份带必需 context 顺序的类型化 payload
- Host 该读的 source basis 路径

Payload 是包跟 host 之间的合同。

## 步骤 5：在这停

你完成 bootstrap。项目现在是 Nimi Coding 采纳。下一步（在 [第一个 Wave 端到端](/zh/nimicoding/tutorials/first-wave-end-to-end)）是真的跑一个 wave。

这个教程里**就在这停**。**不**要把 payload 给 host；**不**要跑重建。Bootstrap 完成了；那就是你的结果。

## 常见问题

| 症状 | 解决 |
| --- | --- |
| `nimicoding start` 抱怨既存文件 | Review 冲突；CLI 保留项目拥有真相、拒覆盖 |
| `nimicoding doctor` 报生命周期漂移 | 再跑 `start`；CLI 在 bootstrap 上幂等 |
| AGENTS.md 改动没应用 | CLI 显示确认；如果你拒了，再跑并确认 |

## 你现在有什么

教程后，项目有：

- 完整的 `.nimi/**` bootstrap。
- `AGENTS.md` 与 `CLAUDE.md` 里的托管 AI 入口。
- 准备 hand off 的 `spec_reconstruction` handoff payload。

你**还没**有：

- 重建出的规范化 spec 树（下一步）。
- 任何 topic / wave / packet 工件（按需要后续创建）。
- 治理中的 AI-coding 工作（你有可用的纪律但**没**进行中的工作）。

## 下一步

如果你想真的在样本任务上用方法学，继续 [第一个 Wave 端到端](/zh/nimicoding/tutorials/first-wave-end-to-end)。

## 这个教程**不**覆盖什么

这个教程**不**覆盖具体 AI host 的 host 特定配置。包是宿主无关的；你能挑任何 admitted host。

## 来源

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/)（CLI 实现）
- [`nimi-coding/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/spec-reconstruction.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
