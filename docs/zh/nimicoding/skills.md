# 技能契约 (Skills)

Nimi Coding 软件包对外暴露了四项**标准技能契约（Declared skills）**。每一个技能，都是一个具有严格类型约束的交互表面，专门用来给已准入的外部 AI 宿主（Host）去实现。这些技能，就是 AI 宿主在 Nimi Coding 纪律约束下干活儿的正式合同。

## 四大核心技能

| 技能 | 是否强制要求 | 目的 |
| --- | --- | --- |
| `spec_reconstruction` | 是 | 将项目当前杂乱无章的现状，重构提炼并收敛进 `.nimi/spec/**` 规范树中 |
| `doc_spec_audit` | 是 | 拿着刚建好的 `.nimi/spec/**` 真相，去逐字对照审计人类手写的文档，寻找出入 |
| `audit_sweep` | 否 | 发起一场对全项目的地毯式审计扫描，并吐出一份冻结的、不可篡改的发现项账本（Findings ledger） |
| `high_risk_execution` | 否 | 在项目的规范真相源彻底成熟定型后，以 Packet（工作包）为边界执行高风险的开发任务 |

## `spec_reconstruction` (规范重建，必须)

这是任何一个刚接纳本方法论的新项目，必须运行的第一个技能。它的使命，是把项目里现有的那堆“大杂烩”——混杂的代码、东拼西凑的文档、过时的架构决定记录 (ADRs) 以及孤零零的 README——一股脑儿地提纯、重构成唯一权威的规范树，统一归置到 `.nimi/spec/**` 目录下。

| 喂给它的输入 | 吐出的输出 |
| --- | --- |
| 各种大杂烩输入（代码、文档、目录结构、人类留下的便签） | 位于 `.nimi/spec/**` 下条理分明的权威规范树，附带一份 `.nimi/spec/_meta/spec-generation-audit.yaml` 审计报告 |

| 技能属性 | 设定的值 |
| --- | --- |
| 触发时机 | 仅在引导阶段（`bootstrap_only`） |
| 铁血输出规则 | “新生成的每一条规范，要么有确凿无疑的证据来源，要么必须挂上醒目的未解决留白（Unresolved gap）标签” |
| 绝对红线约束 | “严禁制造并行的、所谓对人类更友好的影子真相” |

规范重建不是让 AI 去“搞发明创造”。生成的每一条硬性规则，都必须有明确的来源依据；如果来源不足，就老老实实标记为未解决的空白记录在案。

## `doc_spec_audit` (文档规范审计，必须)

在重构出规范树之后，这个技能就轮到上场了。它像个死板的审计员，拿着那份唯一的权威 Spec，去一行行对比人类写的项目文档。它存在的目的就是为了揪出“设计漂移”。

| 喂给它的输入 | 吐出的输出 |
| --- | --- |
| 人类写的文档散文 + 权威的规范树 | 一份详尽的漂移发现项账本 (Drift findings ledger) |

如果文档里写了 Spec 里没有的东西，记上一笔（Finding）。如果文档只是换个说辞把 Spec 里的东西重述了一遍，没问题（OK）。如果文档里的主张跟 Spec **背道而驰**，立刻升级为极其严重的阻塞性报告。

## `audit_sweep` (全量审计扫描，可选)

让 AI 对项目进行一次覆盖全站的“扫地式”审计。它最终会吐出一份被彻底冻结的发现项账本。

| 喂给它的输入 | 吐出的输出 |
| --- | --- |
| 整个项目的全量语料库 | 一份被彻底冻结（Frozen）的发现项账本 |

这里面的“冻结（Frozen）”属性是灵魂所在，它使得这份账本拥有了作为呈堂证供的资格。扫描结果一经录入，便成了铁案，任何人都不允许再回头去篡改它。

## `high_risk_execution` (高风险执行，可选)

这是整套方法论真正的用武之地：在项目真相源成熟之后，以工作包（Packet）为单位去执行高风险的改动任务。这也是 Nimi Coding 煞费苦心设计出那套“四个闭合维度”框架所要保驾护航的核心业务。

| 喂给它的输入 | 吐出的输出 |
| --- | --- |
| 被彻底冻结的执行工作包 (Frozen execution packet) | Worker 撸起袖子干完的产出 + 随单附上的执行证据 |

执行一次 `high_risk_execution`，就是吃进一个冻结的 Packet，并吐出一堆足以让收尾闭合环节（Closeout）拿着放大镜去核验的铁证。

| 技能属性 | 设定的值 |
| --- | --- |
| 触发时机 | 必须在 `.nimi/spec/**` 规范树已经羽翼丰满、成为权威定局之后 |
| 谁是主考官 | 管理者 (Manager) —— 负责最终拍板准入这次执行 |
| 谁来做审计 | 独立循环的第三方 (Independent) —— 严守角色分离铁律 |

## 技能是如何被交接分派的？ (How Skills Are Dispatched)

包内提供了一个命令：`nimicoding handoff`。它负责发射一份极具权威性、机器可读的任务交接载荷（Handoff payload）。

| 字段 | 含义 |
| --- | --- |
| `--skill <skill-id>` | 必须填。指定召唤哪个技能。 |
| `--json` | 吐出最权威的机器可读数据。 |
| `--prompt` | 可选。附带一份让人类也能看懂的给宿主的执行简报。 |

宿主（Host）默默吞下这份 JSON 载荷，跑完相应的技能代码，然后丢回一份结果。Nimi Coding 里的 `nimicoding closeout` 命令在这个时候挺身而出，拿着冷冰冰的类型契约，像法官一样对返回的结果进行准入核验。

## 技能的结果合同 (Skill Result Contracts)

每个技能都不是白跑的，它们返回的结果必须一字不落地遵循对应的类型化合同。

| 技能 | 对应要接受检验的结果合同 |
| --- | --- |
| `spec_reconstruction` | `.nimi/contracts/spec-reconstruction-result.yaml` |
| `doc_spec_audit` | `.nimi/contracts/doc-spec-audit-result.yaml` |
| `audit_sweep` | `.nimi/contracts/audit-sweep-result.yaml` |
| `high_risk_execution` | `.nimi/contracts/high-risk-execution-result.yaml` |

只要返回的结果在哪怕一个微小的结构上违背了对应的合同，在准入阶段就会立刻触发熔断（Fails closed）。在这里，没有任何通融的余地，没有“软通过（Soft acceptance）”。

## 场景案例：新项目运行 `spec_reconstruction`

一个团队刚刚把 Nimi Coding 引进门。项目里目前堆满了各种输入，但还没有一个称得上“权威规范”的东西。

1. **敲下 `nimicoding start`**：引导程序就位。
2. **项目挑选打工仔（AI 宿主）**：选定了对应的适配器覆盖层（比如指定 Codex、Claude，或者是 oh-my-codex）。
3. **发射指令 `nimicoding handoff --skill spec_reconstruction --json`**：Nimi Coding 包把交接载荷发射了出去。
4. **宿主吞下载荷**：在已准入的严苛契约下，开始重构规范树。
5. **宿主吐出结果**：Nimi Coding 包通过 `nimicoding closeout` 命令进行接收入库。
6. **校验时刻**：机器冷酷地扫过：每一条新生成的规则都必须有原始出处，如果找不到出处，必须被打上空白标签（gap-tracking）；少一个就直接打回拒收。
7. **大功告成**：规范树拔地而起。现在，这个项目终于够格用这套纪律来接手高风险任务了。

注意，这个规范重建过程是**极其厂商中立的** —— 只要是个通过了宿主能力大考的入库小弟（AI Host），谁上都能干。

## 场景案例：运行 `audit_sweep` 产出发现项账本

团队想用这套显微镜级别的方法论，对自家的项目做一次彻头彻尾的体检。

1. **敲下指令 `nimicoding handoff --skill audit_sweep --json`**。
2. **宿主领命狂扫**：在被准许查阅的权限范围内，宿主把项目底朝天地翻了一遍；吐出一堆类型化的“发现项”。
3. **账本被死死冻结**：结果一经落库登记，就再也不允许被偷偷改写。
4. **Manager 登场阅卷**：拿着这份沉甸甸的类型化账本，去定夺下一个 Wave 到底该准入谁。

这份账本从此成了铁证（Evidence）。日后要是再做审计，就可以拿着新结果直接和它进行对比。

## 场景案例：一趟完整的 `high_risk_execution` 之旅

团队终于要用这套高压纪律，派 AI 去做一项伤筋动骨的代码重构了。

1. **Manager 放行工作包**：一份冻结了所有必填项约束的 Packet 正式出炉。
2. **实现前审计（先过个安检）**：如果这活儿触发了 `authority_convergence`（权威收敛）的警报，那就得先跑一趟审计；必须把“PASS”牌子拿到手。
3. **发号施令 `nimicoding handoff --skill high_risk_execution --json`**：把锁着手铐的 Packet 扔给宿主。
4. **宿主带着镣铐起舞**：在 Packet 划定的死规矩里干活；吐出改好的代码。
5. **交接班验收**：Nimi Coding 包拿着放大镜对宿主吐出的结果查验合同。
6. **落地后判断**：独立循环的 Auditor 出面重新审视成果；登入 Judgment 判决结果。
7. **收尾大考**：把那要命的“四个闭合维度”全部亮出来，逐个进行灵魂拷问。
8. **终于闭合**：如果考过了，Wave 功德圆满；如果挂了，退回重做。

这就是整套执行流水线的原貌。每一步，都必须经过“准入许可（Admitted）”；系统里没有一步是靠心照不宣完成的。

## 技能“绝对不会”做什么？

| 技能操作 | 是否被严词封杀？ |
| --- | --- |
| 越俎代庖，在 Nimi Coding 自己的包里跑 AI 推理引擎 | **是** —— 跑模型那是宿主该干的事，本包不抢戏 |
| 不走准入流程，就偷偷去改项目的权威真相库 | **是** |
| 生成一份根本找不到溯源依据的“野路子”输出 | **是** （`spec_reconstruction` 规定死了，没有依据就给我挂上留白标签） |
| 宿主的能力安检都没过，还打算蒙混过关往下跑 | **是** （立刻切断电源，Fail closed） |

## 来源依据

- [`nimi-coding/config/skills.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skills.yaml)
- [`nimi-coding/config/skill-manifest.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skill-manifest.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-runtime.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/methodology/skill-installer-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-installer-result.yaml)
- [`nimi-coding/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/spec-reconstruction.yaml)
