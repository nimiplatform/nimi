# 命令行界面 (CLI)

`nimicoding` CLI 是一组功能精简且职责明确的工具集。这个包在设计上刻意遵循了**“边界完整，但不包揽执行” (Boundary-complete, not run-complete)** 的原则：CLI 负责进行配置引导、校验契约规范、并投影记录工件，但它绝不会越俎代庖去全自动跑 Packet 里的代码。

若需查阅各个命令详细的字段级说明，请参考 [参考资料 → CLI 命令手册](/zh/nimicoding/reference/cli-commands)。

## 命令概览

CLI 的动作命令可以被归纳为以下几个极少数的类别：

| 类别 | 核心命令 |
| --- | --- |
| 引导与诊断 (Bootstrap) | `start`, `clear`, `doctor` |
| Topic 生命周期管理 | `topic create`, `topic wave ...`, `topic packet freeze`, `topic worker dispatch`, `topic result record`, `topic closeout ...`, `topic true-close-audit` |
| 自动化推进器 (Runner) | `topic run-next-step`, `topic-runner step`, `topic-runner run` |
| 扫地式审计 (Sweep audit) | `sweep audit plan`, `sweep audit chunk ...`, `sweep audit ledger build`, `sweep audit remediation-map build`, `sweep audit closeout summary`, `sweep audit status` |
| 扫地式设计 (Sweep design) | `sweep design intake`, `sweep design packet-build`, `sweep design packet-build-batch`, `sweep design auditor-prompt`, `sweep design result-ingest`, `sweep design ledger-validate`, `sweep design finalize`, `sweep design wave-plan` |
| 技能交接分派 (Skill handoff) | `handoff`, `closeout` |
| 高风险执行链路 (High-risk execution) | `admit-high-risk-decision`, `ingest-high-risk-execution`, `review-high-risk-execution`, `decide-high-risk-execution` |
| 机械化校验器 (Validators) | 针对 `execution-packet`、`orchestration-state`、`prompt`、`worker-output`、`acceptance` 等各类工件的专项校验器 |
| 规范树审计 (Spec audit) | `validate-spec-tree`, `validate-spec-audit`, `blueprint-audit` |
| 仓库门禁 (Repo gates) | `pnpm check:spec-authority-cutover-readiness`（通过宿主仓库本身的工具链执行） |

每一个类别都有着极其严格的边界；如果想要新增动作，必须通过已准入的契约扩展来实现。

## 引导与诊断 (Bootstrap)

### `nimicoding start`

侦测项目当前状态，将包内的源码投影至项目路径，在 `.nimi/**` 下埋好种子文件，准备出一份极具权威性的 JSON 格式 AI 任务包，并打印出一段可直接粘贴使用的给 AI 的提示词 (Prompt)。

| 属性 | 表现 |
| --- | --- |
| 交互模式 | 会引导你进行：解释 → 确认 → 应用，一步一个脚印。 |
| 失败熔断 | 一旦遇到不认识的 CLI 参数，立即安全报错 (Fail closed)。 |
| 资产保全 | 绝对尊重已存在的真相文件（绝不会强行覆盖）。 |
| 拒绝原则 | 遇到不兼容的引导契约版本，坚决罢工。 |

### `nimicoding clear`

仅仅移除在 `AGENTS.md` 和 `CLAUDE.md` 中受包管控的 AI 块，并且只有在那些归包所有的引导文件与初始种子分毫不差时，才会去移除它们。

| 属性 | 表现 |
| --- | --- |
| 资产保全 | 绝对保留项目自己写的真相源、被你本地修改过的引导文件、`.nimi/spec/**`、`.nimi/local/**` 以及 `.nimi/cache/**`。 |
| 拒绝原则 | 严禁因为暗箱操作导致任何项目拥有的真相或本地工件被删除。 |

### `nimicoding doctor`

对项目的治理基建进行深度体检：核查 `.nimi/**` 引导种子是否存在、契约兼容性、生命周期标记、跨契约的引用对齐情况、宿主适配器的边界状态、已准入覆盖层的状态等等。

| 属性 | 表现 |
| --- | --- |
| 输出格式 | 提供人类可读的终端输出，或通过 `--json` 提供机器可读的数据。 |
| 失败熔断 | 一旦发现生命周期、规范化树与可审计性这三者之间发生了哪怕一丝一毫的漂移脱节，立即安全报错。 |

## Topic 生命周期管理

`topic` 命令族负责打理存放在 `.nimi/topics/{proposal,ongoing,pending,closed}/` 下的那些神圣的 Topic 文件夹。从创建 Topic、添加并选中 Wave、准入 Wave、冻结 Packet，到分派 Worker 或是审计任务，再到记录类型化结果、处理修补和溢出，直至最后闭合 Wave 或 Topic，全套流程都由它接管。

最核心的机械化推进命令长这样：

```bash
nimicoding topic run-next-step <topic-id> --json
```

如果需要连续推进，请使用附带明确 run id 和适配器的 `topic-runner step` 或 `topic-runner run`。在给 Packet 命名时，极其建议带上该 Wave 的身份标识（比如 `wave-1-add-reference-field`）；只有这样，生成出来的 `packet-*.md` 工件才能在 Topic 文件夹里清清楚楚、明明白白。

## 扫地式审计 (Sweep Audit)

`sweep audit` 命令族负责把一个庞大的目标根目录，大刀阔斧地拆解成一个个可供审计的区块 (Chunks)；然后分派这些 Chunk、吞回 Auditor 吐出的证据、记录 Manager 的评审、构建出坚如磐石的不可篡改账本，最终投影出修补地图 (Remediation map) 或是收尾报告。

在生成 Plan 输出时，会汇报所有的 Chunk 工件引用。Chunk 的 ID 就存在那些文件里，并遵循着 Planner 设定的类似 `chunk-001` 的风格。

## 扫地式设计 (Sweep Design)

`sweep design` 命令族在扫地审计实实在在地吐出发现项 (Findings) 后登场。它去读取 `.nimi/local/audit/evidence/<sweep-id>/findings.yaml`，把这些发现项 Fork（分叉）进 `.nimi/local/sweep-design/<run-id>/` 目录下，硬是把一堆粗糙的审计输出，揉捏成一个个可以变成 Topic Wave 的正规规划工件。

它绝对不会去动原始的 Findings 账本。它的职责是去求助 Codex 或其他宿主来审查那些受限的发现项 Packet、要回类型化的设计审计结果、在修订账本里记上一笔、校验账本、敲定本地的设计最终状态，并最终吐出一个**不具有破坏性**的 Wave 推进计划。这套接收机制胃口很好，不论 Auditor 的输出是高度聚焦还是大杂烩，它都能吞下；但在 Topic Wave 被正式准入之前，它绝不会擅自放行 Worker 去执行。

| 阶段 | 扮演的角色 |
| --- | --- |
| `intake` (录入) | 把审计的发现项 Fork 进一个独立的设计工作集。 |
| `packet-build` (封包) | 为一到多个发现项打包出一份专属的设计审计 Packet。 |
| `packet-build-batch` (批量封包) | 打包出一份满是设计审计 Packet 的清单。 |
| `auditor-prompt` (生成 Prompt) | 针对一个 Packet，吐出对应的提示词和它必须遵守的返回格式。 |
| `result-ingest` (摄入结果) | 吞下类型化的设计审计结果，并追加修订记录。 |
| `ledger-validate` (校验账本) | 严格校验修订账本以及最终结论的溯源出处。 |
| `finalize` (敲定定局) | 吐出这份仅存于本地的最终状态报告。 |
| `wave-plan` (规划 Wave) | 吐出供候选参考的 Topic 命令集（且绝不擅自改变当前 Topic 的状态）。 |

## 技能交接分派 (Skill Handoff)

### `nimicoding handoff --skill <skill-id> --json`

向外发射一份极具权威性、机器可读的任务交接载荷（External-handoff payload）。如果附带 `--prompt` 参数，还会顺便打印出一段人类也能看懂的给宿主的执行简报。

| 属性 | 表现 |
| --- | --- |
| 技能指定 | 必须填。(`spec_reconstruction` / `doc_spec_audit` / `audit_sweep` / `high_risk_execution`) |
| 吐出物 | 权威的 JSON 载荷 |
| 宿主姿态 | 绝对厂商中立；完美支持任何已准入的宿主（Claude, Codex, Gemini, OMX 等） |
| 拒绝原则 | 在规范化树准备就绪之前，绝不放行 `doc_spec_audit` 和 `high_risk_execution`。 |

### `nimicoding closeout --skill --outcome --verified-at`

将外部技能执行完毕的结果，强行投影成一份仅存在于本地的收尾闭合载荷。配合 `--write-local` 参数可直接将其写入 `.nimi/local/handoff-results/` 目录下。

| 属性 | 表现 |
| --- | --- |
| 验证关口 | 收尾结果必须通过苛刻的类型化契约的盘问。 |
| 失败熔断 | 如果结果和规范化树唱反调，或者引用越界跑出了声明好的本地目录根，立刻安全报错打回。 |
| 仅限本地 | 这份结果仅仅作为干活的证据，**永远不会**自封为项目的规范语义真相。 |

## 高风险执行链路 (High-Risk Execution)

### `nimicoding admit-high-risk-decision --from <json> --admitted-at <iso8601>`
只接纳拥有 `decisionStatus: manager_decision_recorded` 烙印的 `nimicoding.high-risk-decision.v1` 载荷。它会投影出一份规范准入的预览报告。只有在附带 `--write-spec` 参数时，才会真正动笔写入被追踪的语义真相。

### `nimicoding ingest-high-risk-execution --from <json>`
只接纳被打上 `outcome: completed` 以及 `summary.status: candidate_ready` 标签的 `high_risk_execution` 收尾工件。它会极其死板地机械校验所有引用的工件，并投影出摄入载荷（也是仅限本地）。

### `nimicoding review-high-risk-execution --from <json>`
只接纳携有 `ok: true` 的摄入载荷。它负责投影出带有各种附件的 Review 报告，送去给 Manager 批阅。它会把附件的引用和摄入验证环节的证据一路带过去。

### `nimicoding decide-high-risk-execution --from <json> --acceptance <path> --verified-at <iso8601>`
只接纳携有 `ok: true` 且状态为 `reviewStatus: ready_for_manager_review` 的评审载荷。它会去机械校验那个验收工件；如果你里面敢少写一行 `Disposition:`，它绝不放行。最终，它会投影出 Manager 拍板的本地决策报告。

## 机械化校验器 (Mechanical Validators)

针对每一类工件的专项校验器。它们在干完活后，都会吐出机器可读的 `validator-cli-result.v1` 格式的 JSON。

| 校验器负责抓谁？ | 它校验的是什么？ |
| --- | --- |
| `execution-packet` | 冻结的工作包（Packet）的骨架形状 |
| `orchestration-state` | 调度编排状态记录 |
| `prompt` | 发射出去的提示词载荷 |
| `worker-output` | Worker 干完活吐出来的输出格式 |
| `acceptance` | 验收环节的证据罗列 |

| 属性 | 表现 |
| --- | --- |
| 是否需要指定路径 | 是 |
| 吐出物 | 无论成败，统统吐出 JSON |
| 失败熔断 | 胆敢漏掉必填小节、YAML 格式错乱，或者跟种子契约发生漂移，统统安全报错打回。 |

## Spec 规范审计 (Spec Audit)

### `nimicoding validate-spec-tree`
对 `.nimi/spec` 目录下的规范化真相树结构进行搜身检查。

### `nimicoding validate-spec-audit`
针对 `.nimi/spec/_meta/spec-generation-audit.yaml` 中的每一份文件，对它的立足依据、推断逻辑以及留白空白（Unresolved gap）的追踪记录，进行地毯式查验。

### `nimicoding blueprint-audit`
拿一个项目本地的蓝图根目录，去和 `.nimi/spec` 下的候选规范化树硬碰硬地进行对比。这是一场显式的等价性审计；它只找不同，绝不会自作主张去改动任何路由。

## 场景案例：首次运行引导

当你第一天带着 Nimi Coding 入驻一个项目时：

```bash
nimicoding start
```

CLI 会像个向导一样牵着你走：
1. 侦测当前项目里的底细。
2. 请你确认是否接纳它植入的受管 AI 接入点（`AGENTS.md`、`CLAUDE.md` 块）。
3. 往 `.nimi/**` 目录下播撒归包所有的种子文件。
4. 熟练地为你备好一份最具权威的、专攻 `spec_reconstruction`（规范重建）的 JSON 格式任务包。
5. 在屏幕上打出一段 Prompt。你可以无脑复制，扔给你最心仪的 AI 宿主。

你把 Prompt 喂给 AI，它吭哧吭哧跑完规范重建，然后你拿着结果，用 `nimicoding closeout` 凯旋入库。

## 场景案例：一次完整的高风险执行循环

你的项目现在很成熟了，Spec 规范树也有了。你准备干一票惊天动地的大改动。

| 步骤 | 具体指令 / 动作 |
| --- | --- |
| 1. Manager 放行工作包 | (手搓；搞定 topic.yaml + packet 冰冻工件) |
| 2. 实现前审计（如果触发了的话） | (交给宿主去跑审计；拿到结果并记下 PASS) |
| 3. 把活儿甩给宿主 | `nimicoding handoff --skill high_risk_execution --json` |
| 4. 宿主吭哧干活；吐出结果 | (在宿主那边发生) |
| 5. 收缴结果入库 | `nimicoding ingest-high-risk-execution --from result.json` |
| 6. Review 环节 | `nimicoding review-high-risk-execution --from ingest.json` |
| 7. Manager 终审拍板 | `nimicoding decide-high-risk-execution --from review.json --acceptance accept.md --verified-at ...` |
| 8. 闭合收尾 | (手搓；落定 closeout 收尾工件) |

这里头的每一步，都被 CLI 类型化的校验器死死看守着。但凡你想跳过一步，或者在里头夹带私货偷渡字段，CLI 会当场掀桌子拒绝放行。

## CLI 绝对不会做什么

| 它不干什么 | 为什么它不干？ |
| --- | --- |
| 自主运行并推演 Packet | 因为执行的主导权牢牢攥在宿主 AI 手里 |
| 召唤供应商的 API 模型 | 因为这个包才不管你用哪家的 AI |
| 自动化日程调度 | 怎么排期那也是宿主该操心的事 |
| 发送通知消息 | 用户体验那层是宿主的自留地 |
| 自我热更新 | 跑出了独立包的范畴，不碰 |

上面这些，全都是它**显式推迟（Explicitly deferred）**、划清界限的表面。

## 来源依据

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md) (CLI 章节)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/) (CLI 的源码实现)
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/audit-plan.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/audit-plan.schema.yaml)
- [`nimi-coding/contracts/sweep-design-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/sweep-design-result.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/methodology/skill-installer-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-installer-result.yaml)
- [`nimi-coding/contracts/execution-packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/execution-packet.schema.yaml)
- [`nimi-coding/contracts/orchestration-state.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/orchestration-state.schema.yaml)
- [`nimi-coding/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/prompt.schema.yaml)
- [`nimi-coding/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/worker-output.schema.yaml)
- [`nimi-coding/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/acceptance.schema.yaml)