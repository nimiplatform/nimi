# 教程：跑一个受治理的 Codex 项目

你在 Codex 里有一个现成的代码仓库，希望让 Codex 承担一些有分量的活：重建项目知识、讨论一项需求、规划 wave、跑长时间审计、按 finding 修复或实施，并在不丢失范围控制的前提下把工作收尾。

加上 Nimi Coding 之后，你和 Codex 的对话还是自然语言。差别在于：Codex 会把工作过程持续地落进仓库——`.nimi/spec/**` 是权威，`.nimi/topics/**` 是 topic 状态，`.nimi/local/audit/**` 是审计证据。

## 启动项目

告诉 Codex：

```text
Set up Nimi Coding in this repository for Codex. Install the package if
needed, bootstrap the `.nimi/**` layer, run the health check, and report
only the meaningful changes. Do not start a topic yet.
```

Codex 会跑安装命令，包括：

```bash
npm install --save-dev @nimiplatform/nimi-coding
npx nimicoding start --host codex
npx nimicoding doctor --json
```

Codex 应当回一份简短的状态报告：

| Codex 报告内容 | 含义 |
| --- | --- |
| 包已安装 | 项目里能用 `nimicoding` CLI |
| `.nimi/**` 已写入 | 项目有了契约、方法学、配置与本地状态根 |
| 受管 AI 入口已更新 | 后续 Codex 会话能看到项目规则 |
| `doctor` 通过或指出漂移 | 引导要么健康，要么因明确原因被阻断 |

到这一步，Codex 还没有动产品代码。它只创建了后续工作要用到的治理面。

## 重建规范

接下来让 Codex 把现有项目重建为权威规范树：

```text
Use Nimi Coding to reconstruct this repository into `.nimi/spec/**`.
Read the handoff payload, inspect the code and docs, write canonical
spec files with source basis and unresolved-gap tracking, then validate
the result. Stop if the contract cannot be satisfied.
```

Codex 走 Nimi Coding 的重建交接与校验路径：

```bash
npx nimicoding handoff --skill spec_reconstruction --json
npx nimicoding handoff --skill spec_reconstruction --prompt
npx nimicoding closeout --from spec-reconstruction-result.json --write-local
npx nimicoding validate-spec-tree .nimi/spec
npx nimicoding validate-spec-audit .nimi/spec/_meta/spec-generation-audit.yaml
npx nimicoding doctor --json
```

有用的结果不只是"规范已生成"。Codex 应当报告：

| 证据 | 检查点 |
| --- | --- |
| `.nimi/spec/**` | 项目现在有了权威树 |
| `.nimi/spec/_meta/spec-generation-audit.yaml` | 生成的文件有 source basis 引用，或记录了缺口 |
| closeout 结果 | 重建动作是在强类型契约下被准入的 |
| 校验输出 | 结构性与可审计性检查通过 |

如果 Codex 无法用项目证据支撑某条规范主张，它应当记录一个未解决缺口。这比凭空写一条干净规则要好。

## 讨论工作

用自然语言描述真实任务：

```text
I want a fresh full audit of the repository against the current spec.
It should cover architecture, docs, runtime, SDK, apps, and Nimi Coding
governance. It needs to run for a long time if necessary, remain
resumable, and avoid silent closure.
```

Codex 应当先把这个请求转化成一份 topic 提案，再去做审计。一个合格的回应像这样：

```text
I will create a topic for a fresh full audit. Proposed waves:
1. sweep audit
2. sweep design
3. implementation waves from confirmed findings
4. closeout

Proposed owner domains:
.nimi/spec/**, docs/**, runtime/**, sdk/**, apps/**, nimi-coding/**

Please confirm the scope before I admit the first wave.
```

回应背后，Codex 可能跑：

```bash
npx nimicoding topic create fresh-full-audit \
  --title "Fresh full audit" \
  --justification "Audit the repository against current spec authority, produce typed findings, and avoid silent closure." \
  --json
```

这步确认很关键。它把一个宽泛请求挡住，避免变成一场漫无边界的"Codex 给我审一遍"。

## 准入审计 wave

复核完范围，再告诉 Codex：

```text
Admit the audit wave. Do not start the full audit yet. First produce
the packet, preflight evidence, owner domains, negative tests, and stop
conditions for the audit plan.
```

Codex 创建并准入 wave，冻结 packet，然后问 topic runner 接下来能干什么：

```bash
npx nimicoding topic wave add <topic-id> wave-1-sweep-audit sweep-audit ...
npx nimicoding topic wave select <topic-id> wave-1-sweep-audit --json
npx nimicoding topic wave admit <topic-id> wave-1-sweep-audit --json
npx nimicoding topic packet freeze <topic-id> --from packet-wave-1-sweep-audit.md --json
npx nimicoding topic run-next-step <topic-id> --json
```

Codex 应展示它创建的文件以及当下的判定：

| 工件 | 你为什么要复核 |
| --- | --- |
| `topic.yaml` | 显示当前 wave 与 topic 状态 |
| `packet-wave-1-sweep-audit.md` | 定义 Codex 可读、可写、可主张的边界 |
| preflight 结果 | 记录设计是否可安全执行 |
| `run-next-step` 输出 | 指出工作是否可继续，或必须停下 |

你不需要手写 packet YAML。你需要的是在 Codex 花数小时按它执行之前，复核这份契约。

## 跑审计

设计 wave 通过后，告诉 Codex：

```text
Run the admitted audit sweep. Use chunks, record evidence per chunk,
review findings before freezing the ledger, and stop if any chunk
cannot be audited inside the packet boundary.
```

Codex 在内部用 `sweep audit`：

```bash
npx nimicoding sweep audit plan --root . --sweep-id fresh-full-audit --max-files 40 --json
npx nimicoding sweep audit chunk dispatch --sweep-id fresh-full-audit --chunk-id chunk-001 ...
npx nimicoding sweep audit chunk ingest --sweep-id fresh-full-audit --chunk-id chunk-001 ...
npx nimicoding sweep audit chunk review --sweep-id fresh-full-audit --chunk-id chunk-001 ...
npx nimicoding sweep audit ledger build --sweep-id fresh-full-audit --json
```

长时间运行中，要状态而不是叙述：

```text
Give me the current sweep audit status: planned chunks, reviewed
chunks, open findings, next chunk, current stop condition, and evidence
root.
```

Codex 应当用状态语言回答：

```text
Audit sweep status:
- planned chunks: 18
- reviewed chunks: 6
- blocking findings: 3
- next chunk: chunk-007
- current stop condition: continue
- evidence root: .nimi/local/audit/
```

这种状态能跨长会话留存。Codex 中途暂停或几小时后继续，都能凭 topic 与审计工件接着往下，不靠记忆。

## 把 finding 转成 wave

账本生成之后，下一步不是"请把所有问题都修了"。让 Codex 从 finding 出发做设计：

```text
Use sweep design on `fresh-full-audit`. Build design-auditor packets
from the findings, produce auditor prompts, ingest typed auditor
results, validate the revision ledger, finalize the design state, and
produce a wave plan. If any result reports an authority fork,
insufficient evidence, or a needed product decision, stop and ask me the
question before admitting implementation work.
```

Codex 内部走 `sweep design`：

```bash
npx nimicoding sweep design intake --sweep-id fresh-full-audit --run-id fresh-full-audit-design --json
npx nimicoding sweep design packet-build-batch --run-id fresh-full-audit-design --batch-size 10 --json
npx nimicoding sweep design auditor-prompt --run-id fresh-full-audit-design --packet-id packet-001 --json
npx nimicoding sweep design result-ingest --run-id fresh-full-audit-design --from design-auditor-result.yaml --mode focused --json
npx nimicoding sweep design ledger-validate --run-id fresh-full-audit-design --json
npx nimicoding sweep design finalize --run-id fresh-full-audit-design --json
```

批量生成 packet 只在 Codex 已经把清单看够、能选定一个安全批边界时才合适。否则它应当用 `packet-build` 生成更小的 packet，并就证据不足、判断重叠或需要产品决策的 finding 主动提问。

如果 `result-ingest`、`ledger-validate` 或 `finalize` 返回需要人工决策或证据缺口，Codex 应展示决策队列而不是继续推进。一个合格的反问写得很具体：

```text
This cluster cannot become implementation yet. It touches docs and
spec authority differently. Recommended decision: align the spec first,
then admit one docs implementation wave. Confirm or choose another
owner boundary.
```

决策记录之后（或所有 cluster 都就绪后），Codex 继续：

```bash
npx nimicoding sweep design ledger-validate --run-id fresh-full-audit-design --json
npx nimicoding sweep design finalize --run-id fresh-full-audit-design --json
npx nimicoding sweep design wave-plan --run-id fresh-full-audit-design --topic-id <topic-id> --json
```

Wave 规划只输出候选的 `topic wave add` 与 `topic wave admit` 命令。它不会改写 topic 状态，也不允许 worker 派发。Codex 应展示候选 wave，等你确认实施边界。

## 用 `/goal` 让 Codex 跑下去

对于多小时的工作，给 Codex 一个目标，把 topic 契约嵌进循环里：

```text
/goal Continue topic <topic-id> until the current admitted wave reaches
a typed stop condition. Before every phase transition, run
`npx nimicoding topic run-next-step <topic-id> --json`. If the decision
is not `continue`, stop and report the required human evidence. Do not
write outside the active packet owner domain. Do not claim closure
without recorded evidence.
```

这把 Codex 的长时间执行能力转成一个受治理的循环：

| 目标指令 | 效果 |
| --- | --- |
| 继续指定 topic | 工作状态在仓库里，不只在对话里 |
| 跑 `topic run-next-step` | 阶段切换都经过强类型决策 |
| 当结果不是 `continue` 就停 | 人工关卡与证据缺口始终可见 |
| 留在 owner 域内 | 范围不会悄悄外扩 |
| 关闭前要有证据 | "看起来完成了"不算 |

这就是一份 40 小时的审计仍可被审视的方式。Codex 反复回到 topic 状态、packet 边界、分块证据、closeout 标准上来。

## 收尾

Codex 说 wave 完成时，要的是关闭，不是泛泛总结：

```text
Validate the active topic, record the final result, evaluate authority,
semantic, consumer, and drift-resistance closure, run true close if the
topic is ready, and show any remaining blockers.
```

Codex 在内部记录结果与 closeout：

```bash
npx nimicoding topic result record <topic-id> --kind audit --verdict PASS ...
npx nimicoding topic closeout wave <topic-id> <wave-id> ...
npx nimicoding topic true-close-audit <topic-id> --judgement "..." --json
npx nimicoding topic closeout topic <topic-id> ...
```

最终回答应围绕闭合维度来组织：

| 闭合维度 | Codex 必须证明 |
| --- | --- |
| 权威 | 没有未准入的权威漂移残留 |
| 语义 | finding 与改动符合规范与 packet |
| 消费 | 目标读者或工作流确实可用结果 |
| 漂移阻力 | 已检查禁止捷径与重开条件 |

任何一个维度被阻塞，Codex 都应指出缺哪类证据，并保留 topic 不关。

## 与直接用 Codex 的差别

| 直接用 Codex | 配合 Nimi Coding |
| --- | --- |
| Codex 直接开始读和改 | Codex 先建立 topic 范围与 packet 边界 |
| 进度只在对话里 | 进度在 `.nimi/topics/**` 与 `.nimi/local/audit/**` |
| 完成与否由模型判断 | 完成与否由四闭环判断 |
| Finding 是散文 | Finding 是强类型证据与账本 |
| 范围会漂 | Owner 域与 packet 约束工作 |
| 用户只复核最终回答 | 用户在过程中复核关卡与证据 |

目标不是给用户多加流程，而是让 Codex 能干大活，同时留下另一段会话、另一个审计员或人工管理者都能复检的轨迹。

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/)
- [`nimi-coding/config/skills.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skills.yaml)
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/wave.schema.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/audit-plan.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/audit-plan.schema.yaml)
- [`nimi-coding/contracts/audit-ledger.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/audit-ledger.schema.yaml)
- [`nimi-coding/contracts/sweep-design-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/sweep-design-result.yaml)
- [`nimi-coding/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/spec-reconstruction.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
