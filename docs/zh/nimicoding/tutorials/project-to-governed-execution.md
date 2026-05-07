# 教程：在 Codex 里跑受治理的项目工作

你已经在 Codex 里打开了一个仓库。你想让 Codex 做的不是一两个小改动，而是更重的工作：整理项目知识、讨论需求、规划 wave、长时间审计、执行修复、最后给出可审的闭合证据。

使用 Nimi Coding 时，你仍然用自然语言跟 Codex 沟通。不同的是，Codex 会把工作状态写进仓库：`.nimi/spec/**` 记录权威，`.nimi/topics/**` 记录 topic 状态，`.nimi/local/audit/**` 记录审计证据。

## 开始项目

对 Codex 说：

```text
请在这个仓库里设置 Nimi Coding，以 Codex 作为宿主。需要安装包就安装，
bootstrap `.nimi/**`，跑健康检查，只汇报有意义的改动。先不要开始 topic。
```

Codex 会执行 setup：

```bash
npm install --save-dev @nimiplatform/nimi-coding
npx nimicoding start --host codex
npx nimicoding doctor --json
```

你应该看到一份状态报告：

| Codex 汇报 | 含义 |
| --- | --- |
| 包已安装 | 项目里能使用 `nimicoding` CLI |
| `.nimi/**` 已初始化 | 项目有了合同、方法论、配置与本地状态根 |
| AI 入口块已更新 | 后续 Codex session 能看到项目规则 |
| `doctor` 通过或命名 drift | Bootstrap 健康，或带明确原因阻塞 |

这一步还不改产品代码。它只建立后续工作要遵守的治理面。

## 重建 Spec

接着让 Codex 把项目现状整理成规范化 spec：

```text
请用 Nimi Coding 把这个仓库重建成 `.nimi/spec/**`。读取 handoff，
检查代码和文档，写出带 source basis 和 unresolved-gap tracking 的规范化 spec，
然后跑校验。合同满足不了就停。
```

Codex 会走 reconstruction 和 validation：

```bash
npx nimicoding handoff --skill spec_reconstruction --json
npx nimicoding handoff --skill spec_reconstruction --prompt
npx nimicoding closeout --from spec-reconstruction-result.json --write-local
npx nimicoding validate-spec-tree .nimi/spec
npx nimicoding validate-spec-audit .nimi/spec/_meta/spec-generation-audit.yaml
npx nimicoding doctor --json
```

你要看的不是“生成完了”这句话，而是这些证据：

| 证据 | 检查什么 |
| --- | --- |
| `.nimi/spec/**` | 项目有了权威树 |
| `.nimi/spec/_meta/spec-generation-audit.yaml` | 生成文件有 source basis 或记录 gap |
| closeout result | 重建结果按类型化合同准入 |
| validation output | 结构和可审计性通过 |

Codex 如果找不到项目证据支撑某条规范，就应该记录 gap，而不是编出一条看似完整的规则。

## 讨论真实工作

现在可以用普通语言描述需求：

```text
我想对整个仓库做一次 fresh full audit，对照当前 spec 找架构、文档、
runtime、SDK、apps、Nimi Coding 治理里的 blocking 问题。这个审计要能长时间运行，
能恢复，不能静默闭合。
```

Codex 不应该马上开始扫文件。它应该先提出 topic 计划：

```text
我会创建一个 fresh full audit topic。建议 waves：
1. sweep audit
2. sweep design
3. 根据已确认 findings 拆出的实现 waves
4. closeout

建议 owner domains：
.nimi/spec/**, docs/**, runtime/**, sdk/**, apps/**, nimi-coding/**

请确认 scope，然后我再准入第一个 wave。
```

背后 Codex 可能会运行：

```bash
npx nimicoding topic create fresh-full-audit \
  --title "Fresh full audit" \
  --justification "Audit the repository against current spec authority, produce typed findings, and avoid silent closure." \
  --json
```

这个确认点很重要。它让大任务先变成有边界的 topic，而不是一段“Codex 帮我审完”的长聊天。

## 准入审计 Wave

确认范围后，对 Codex 说：

```text
准入 audit wave。先不要开始完整审计。请先产出 packet、preflight evidence、
owner domains、negative tests 和开始审计前的 stop conditions。
```

Codex 会创建并准入 wave、冻结 packet、询问 topic runner 下一步：

```bash
npx nimicoding topic wave add <topic-id> wave-1-sweep-audit sweep-audit ...
npx nimicoding topic wave select <topic-id> wave-1-sweep-audit --json
npx nimicoding topic wave admit <topic-id> wave-1-sweep-audit --json
npx nimicoding topic packet freeze <topic-id> --from packet-wave-1-sweep-audit.md --json
npx nimicoding topic run-next-step <topic-id> --json
```

Codex 应该列出它写下的工件和当前 decision：

| 工件 | 你为什么要 review |
| --- | --- |
| `topic.yaml` | 当前 active wave 和 topic 状态 |
| `packet-wave-1-sweep-audit.md` | Codex 能读什么、写什么、不能声称什么 |
| preflight result | 设计是否可以进入执行 |
| `run-next-step` output | 可以继续，还是必须等人或等证据 |

用户不用手写 packet YAML。但用户应该 review packet，因为那就是 Codex 接下来几个小时要遵守的合同。

## 运行审计

设计 wave 接受后，对 Codex 说：

```text
执行已经准入的 audit sweep。用 chunk 跑。每个 chunk 都记录证据，
finding 进 ledger 前先 review；如果某个 chunk 不能在 packet 边界内审计，就停。
```

Codex 背后会用 `sweep audit`：

```bash
npx nimicoding sweep audit plan --root . --sweep-id fresh-full-audit --max-files 40 --json
npx nimicoding sweep audit chunk dispatch --sweep-id fresh-full-audit --chunk-id chunk-001 ...
npx nimicoding sweep audit chunk ingest --sweep-id fresh-full-audit --chunk-id chunk-001 ...
npx nimicoding sweep audit chunk review --sweep-id fresh-full-audit --chunk-id chunk-001 ...
npx nimicoding sweep audit ledger build --sweep-id fresh-full-audit --json
```

长跑时，不要只问“进展如何”。问状态：

```text
汇报当前 sweep audit status：planned chunks、reviewed chunks、open findings、
next chunk、current stop condition 和 evidence root。
```

Codex 应该用状态回答：

```text
Audit sweep status:
- planned chunks: 18
- reviewed chunks: 6
- blocking findings: 3
- next chunk: chunk-007
- current stop condition: continue
- evidence root: .nimi/local/audit/
```

这个状态能跨越长会话。Codex 暂停、恢复，甚至几个小时后继续，都可以从 topic 和 audit 工件里找回下一步。

## 把 Findings 变成 Waves

Ledger 已经存在之后，下一句不应该是「把所有问题都修了」。让 Codex 先把 findings 设计成可准入的工作：

```text
请对 `fresh-full-audit` 跑 sweep design。从 findings 构建设计审计 packet，
生成 auditor prompt，ingest 类型化 auditor result，校验 revision ledger，
finalize 设计状态，并产出 wave plan。如果某个结果报告权威分叉、证据不足、
或需要产品判断，先停下来问我，不要准入实现工作。
```

Codex 背后会用 `sweep design`：

```bash
npx nimicoding sweep design intake --sweep-id fresh-full-audit --run-id fresh-full-audit-design --json
npx nimicoding sweep design packet-build-batch --run-id fresh-full-audit-design --batch-size 10 --json
npx nimicoding sweep design auditor-prompt --run-id fresh-full-audit-design --packet-id packet-001 --json
npx nimicoding sweep design result-ingest --run-id fresh-full-audit-design --from design-auditor-result.yaml --mode focused --json
npx nimicoding sweep design ledger-validate --run-id fresh-full-audit-design --json
npx nimicoding sweep design finalize --run-id fresh-full-audit-design --json
```

批量生成 packet 只适合 Codex 已经看过 inventory，并能选出安全 batch 边界的情况。否则它应该用 `packet-build` 拆更小的 packet，并为需要更多证据、duplicate 判断或产品判断的 finding 写明确问题。

如果 `result-ingest`、`ledger-validate` 或 `finalize` 返回 human-decision 或 evidence-gap 状态，Codex 应该汇报 decision queue，而不是继续。好的问题应该具体：

```text
这个 cluster 还不能进入实现。它同时碰到 docs 和 spec 权威。
建议先对齐 spec，再准入一个 docs 实现 wave。请确认这个 owner 边界，
或指定另一个边界。
```

决策记录之后，或者所有 cluster 都已 ready，Codex 再继续：

```bash
npx nimicoding sweep design ledger-validate --run-id fresh-full-audit-design --json
npx nimicoding sweep design finalize --run-id fresh-full-audit-design --json
npx nimicoding sweep design wave-plan --run-id fresh-full-audit-design --topic-id <topic-id> --json
```

Wave plan 只输出候选 `topic wave add` 和 `topic wave admit` 命令。它不改 topic 状态，也不允许 worker dispatch。Codex 应该把候选 waves 列出来，等你接受实现边界。

## 用 `/goal` 托管长跑

多小时任务可以交给 Codex 的 goal：

```text
/goal Continue topic <topic-id> until the current admitted wave reaches
a typed stop condition. Before every phase transition, run
`npx nimicoding topic run-next-step <topic-id> --json`. If the decision
is not `continue`, stop and report the required human evidence. Do not
write outside the active packet owner domain. Do not claim closure
without recorded evidence.
```

这会把 Codex 的长时间执行能力变成受治理的循环：

| Goal 指令 | 效果 |
| --- | --- |
| Continue 具名 topic | 工作状态存在仓库里，不只在聊天里 |
| 跑 `topic run-next-step` | 转阶段要经过类型化 decision |
| 不是 `continue` 就停 | 人工确认和缺证据不会被吞掉 |
| 只在 owner domain 内写 | 范围不会悄悄扩大 |
| 闭合前记录证据 | “看起来做完了”不算完成 |

40 小时审计能保持可审，是因为 Codex 一直回到 topic state、packet 边界、chunk evidence 和 closeout 标准。

## 闭合工作

当 Codex 说 wave 完成时，不要只要总结。让它闭合：

```text
请 validate 当前 topic，记录最终 result，评估 authority、semantic、consumer、
drift-resistance 四个闭合维度。如果 topic 已准备好，跑 true close。
最后列出任何剩余 blocker。
```

Codex 会在背后记录 result 和 closeout：

```bash
npx nimicoding topic result record <topic-id> --kind audit --verdict PASS ...
npx nimicoding topic closeout wave <topic-id> <wave-id> ...
npx nimicoding topic true-close-audit <topic-id> --judgement "..." --json
npx nimicoding topic closeout topic <topic-id> ...
```

最终回答应该按闭合维度组织：

| 闭合维度 | Codex 必须证明 |
| --- | --- |
| 权威闭合 | 没有未准入的权威漂移 |
| 语义闭合 | Finding 和改动符合 spec 与 packet |
| 消费方闭合 | 目标读者或工作流能使用结果 |
| 抗漂移闭合 | 禁用捷径和 reopen condition 已检查 |

任何维度 blocked，Codex 都应该说缺什么证据，并保持 topic open。

## 跟直接用 Codex 的差别

| 直接请求 Codex | 用 Nimi Coding 托住 Codex |
| --- | --- |
| Codex 直接开始读和改 | Codex 先创建 topic scope 和 packet 边界 |
| 进展存在聊天里 | 进展存在 `.nimi/topics/**` 与 `.nimi/local/audit/**` |
| Done 由模型判断 | Done 由四个闭合维度判断 |
| Finding 是散文 | Finding 进入类型化证据和 ledger |
| 范围容易漂 | Owner domain 和 packet 限制范围 |
| 用户只 review 最终答案 | 用户沿途 review topic、wave、packet、audit、closeout |

目标不是让用户多操作 CLI。目标是让 Codex 能做大工作，同时留下另一个 session、auditor 或人类 manager 都能检查的证据。

## 来源

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/)
- [`nimi-coding/config/skills.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skills.yaml)
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/wave.schema.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/audit-plan.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/audit-plan.schema.yaml)
- [`nimi-coding/contracts/audit-ledger.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/audit-ledger.schema.yaml)
- [`nimi-coding/contracts/sweep-design-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/sweep-design-result.yaml)
