# World-Studio -> Narrative -> TextPlay -> VideoPlay 文档升级方案（Final State 版）

日期：2026-03-02  
作者：Codex（基于仓库现状与外部工程样本代码审读）

## 1. 目标与边界

本方案只定义一个目标状态：一次性补齐 `world-studio -> narrative-engine -> textplay -> videoplay` 全链路文档合同，不引入阶段性中间态。

必须达成的三类规则：

1. 全链路运行规则：任务如何运行、失败如何恢复、断线如何不中断继续。
2. 创作操作规则：插镜头、改镜头、变体、重生成、撤销、分支、合成影响面。
3. 自动守卫规则：禁止项、回退检查、跨模块契约破坏检测、prompt 治理。

边界约束：

1. `videoplay` 不是单体，必须放在链路上下文中定义职责。
2. `nimi-runtime` 负责 API/模型管理，mods 文档只定义消费协议与行为约束。
3. 文档先行，但文档必须可验证、可生成、可回归，不允许“描述性空文档”。
4. 项目未上线，不引入历史兼容层、迁移层、双轨协议。

## 2. Final State 原则

1. 不采用阶段性拆分交付，不接受“先写一部分规则再补剩余规则”的中间态。
2. 所有新增规则必须同时提供：`rule id`、`table source`、`verification command`。
3. 链路级 SSOT 只定义跨模块协议与不变量；模块级 SSOT/spec 负责本模块执行合同。
4. 对标只迁移工程方法，不复制 vendor 绑定字段和 prompt 文本。
5. 连续性规则不绑定某个 UI 形态；时间线编辑器只是承载方式之一，不是唯一机制。
6. 任一新增规则若无法映射到当前四链路的接口、状态机或数据模型，判定为过度设计并删除。
7. 非目标明确排除：权限治理、商业结算、运营分发、跨版本迁移兼容。

## 3. 对标证据：外部工程样本经验映射

| 工程能力 | 外部样本代码证据（文件） | 迁移方式 | Nimi 文档落点 |
|---|---|---|---|
| 任务状态与重试生命周期 | `src/lib/workers/shared.ts`, `src/lib/workers/utils.ts` | 直接仿做机制 | `ssot/mod/worldstudio-narrative-chain-run-protocol.md` + 各 mod `run-states.yaml` |
| Run 事件协议与 seq 流 | `src/lib/run-runtime/service.ts`, `graph-executor.ts`, `publisher.ts` | 直接仿做机制 | `worldstudio-narrative-chain-run-protocol.md`（RunEvent、seq、checkpoint） |
| 断线恢复与事件补拉 | `src/lib/query/hooks/run-stream/recovered-run-subscription.ts`, `state-machine.ts` | 直接仿做机制 | `worldstudio-narrative-chain-run-protocol.md`（snapshot + gap refill + replay） |
| 创作编辑闭环（插镜头/变体/回退） | `src/app/api/novel-promotion/*insert-panel*`, `*panel-variant*`, `*undo-regenerate*` | 直接仿做机制 | `videoplay/spec/kernel/creator-workflow-contract.md` |
| 分镜连续性（链接+首尾帧） | `*panel-link*`, `useVideoFirstLastFrameFlow.ts` | 借鉴思路，本地化数据结构 | `creator-operations.yaml` + `continuity-constraints.yaml` |
| Prompt 治理（ID、模板、变量校验） | `src/lib/prompt-i18n/prompt-ids.ts`, `build-prompt.ts` | 直接仿做治理框架 | `prompt-governance-contract.md` + `prompt-canary-cases.yaml` |
| 路由/任务/合同覆盖矩阵 | `src/lib/task/*`, `src/app/api/runs/*`, route handlers | 直接仿做机制 | `worldstudio-narrative-chain-guard-governance.md` + coverage matrix 表 |

说明：样本中的 `VideoTimelinePanel.tsx` 当前主要是视频阶段面板容器，不等同于成熟 NLE 时间线；连续性能力更多由分镜链接、首尾帧流程与生成约束共同承担。Nimi 文档应按“连续性控制规则”建模，而不是把责任硬塞给时间线 UI。

## 4. 当前差距复盘（面向 Final State）

## 4.1 全链路运行规则差距

1. 缺统一跨 mod 的 RunEvent 合同，当前只有模块内状态语义。
2. 缺恢复细则：snapshot 结构、`seq` 断档补拉、重连回放、attempt 归并。
3. 缺失败分流标准：重试边界、不可恢复边界、用户动作提示规范。

## 4.2 创作操作规则差距

1. 现有文档强调“生成产线”，未形成“可编辑产线”合同。
2. 缺工程已验证的最小操作闭环：插镜头、改镜头、变体、重生成、撤销、分镜链接、首尾帧、配音/口型联动。
3. 缺操作影响面矩阵：哪些操作只重跑 shot，哪些扩散到 clip/episode。

## 4.3 自动守卫规则差距

1. 现有守卫偏文档一致性，缺行为一致性硬闸。
2. 缺跨模块契约变更联动校验（`CoreOutput` 字段变更未强制 downstream 校验）。
3. 缺 prompt 治理合同（注册、变量 schema、结构化输出、canary 失败处理）。

## 5. Final State 文档结构蓝图

## 5.1 链路级 SSOT（新增/更新）

1. `ssot/mod/worldstudio-narrative-rendering.md`（UPDATE）  
   作用：作为链路总入口，索引 run protocol、creator workflow、guard governance 三大域。
2. `ssot/mod/worldstudio-narrative-chain-run-protocol.md`（ADD）  
   作用：定义跨 mod 运行事件、恢复协议、取消协议、重试分类、可观测字段。
3. `ssot/mod/worldstudio-narrative-chain-guard-governance.md`（ADD）  
   作用：定义禁止模式、覆盖矩阵、回归门禁、裁决顺序。

## 5.2 模块级 SSOT/Spec（新增/更新）

1. `nimi-mods/runtime/world-studio/SSOT.md`（UPDATE）  
   作用：强化对 narrative 可消费投影契约与 trace 完整性要求。
2. `nimi-mods/modules/narrative-engine/spec/kernel/run-orchestration-contract.md`（ADD）
3. `nimi-mods/modules/narrative-engine/spec/kernel/tables/run-states.yaml`（ADD）
4. `nimi-mods/runtime/textplay/spec/kernel/run-orchestration-contract.md`（ADD）
5. `nimi-mods/runtime/textplay/spec/kernel/tables/run-states.yaml`（ADD）
6. `nimi-mods/runtime/videoplay/spec/kernel/creator-workflow-contract.md`（ADD）
7. `nimi-mods/runtime/videoplay/spec/kernel/version-lineage-contract.md`（ADD）
8. `nimi-mods/runtime/videoplay/spec/kernel/prompt-governance-contract.md`（ADD）
9. `nimi-mods/runtime/videoplay/spec/kernel/tables/creator-operations.yaml`（ADD）
10. `nimi-mods/runtime/videoplay/spec/kernel/tables/rebuild-impact-matrix.yaml`（ADD）
11. `nimi-mods/runtime/videoplay/spec/kernel/tables/continuity-constraints.yaml`（ADD）
12. `nimi-mods/runtime/videoplay/spec/kernel/tables/version-lineage-policy.yaml`（ADD）
13. `nimi-mods/runtime/videoplay/spec/kernel/tables/forbidden-patterns.yaml`（ADD）
14. `nimi-mods/runtime/videoplay/spec/kernel/tables/prompt-canary-cases.yaml`（ADD）
15. `nimi-mods/runtime/videoplay/spec/INDEX.md`（UPDATE）
16. `nimi-mods/modules/narrative-engine/spec/INDEX.md`（UPDATE）
17. `nimi-mods/runtime/textplay/spec/INDEX.md`（UPDATE）

约束说明：

1. 上述文件清单已做过度设计裁剪，仅保留“可直接映射到四链路当前能力”的合同。
2. 不新增历史兼容迁移文档、兼容层文档或双协议文档。

## 5.3 证据文档（新增）

1. `dev/report/worldstudio-narrative-textplay-videoplay-doc-upgrade-evidence-YYYY-MM-DD.md`（ADD）  
   作用：记录本轮生成、校验、回归证据；不写入 SSOT。

## 6. 规则详设（Final State 必须项）

## 6.1 全链路运行规则（Run Protocol）

## 6.1.1 统一 RunEvent 模型

最小必填字段：

1. `traceId`
2. `runId`
3. `stage`（world-studio | narrative-engine | textplay | videoplay）
4. `step`
5. `seq`（单调递增）
6. `eventType`（run.start | step.start | step.chunk | step.complete | step.error | run.complete | run.error | run.canceled）
7. `attempt`
8. `timestamp`

条件必填字段：

1. 写操作事件必须带 `idempotencyKey`。
2. 可恢复事件必须带 `checkpointToken`、`stepInputHash`、`lastCompletedUnit`。
3. 失败事件必须带 `reasonCode`、`actionHint`、`retryClass`。

## 6.1.2 断线恢复协议

恢复合同必须包含：

1. `runSnapshot`：包含每个 step 的最后稳定状态与恢复指针。
2. `lastAckedSeq`：客户端已确认序号。
3. `gapRefill`：当服务端发现 `seq` 断档，必须补拉缺失事件后再继续流式推送。
4. `attemptCanonicalization`：重试造成的 late chunk 必须归并到同一 step attempt，不得污染最终状态。
5. `cancelBridge`：用户取消必须映射到运行态和任务态双向一致。

## 6.1.3 失败分类与动作分流

1. `retryable`：route unavailable、provider timeout、短暂解析错误。
2. `non-retryable`：contract violation、forbidden pattern hit、immutable facts mismatch。
3. 用户动作固定为：`continue-from-checkpoint`、`rerun-step`、`cancel-run`，不得输出含糊提示。

## 6.2 创作操作规则（Creator Workflow）

## 6.2.1 工程已验证的最小操作闭环（MUST）

1. `insert-shot`
2. `update-shot`
3. `delete-shot`
4. `regenerate-shot`
5. `create-shot-variant`
6. `undo-last-regeneration`
7. `link-shot-transition`
8. `generate-first-last-frame`
9. `generate-voice-line`
10. `apply-lip-sync`
11. `create-branch`
12. `switch-branch`

扩展操作（SHOULD）：

1. `split-shot`
2. `merge-shots`
3. `reorder-shot`
4. `redo`
5. `merge-branch`

## 6.2.2 连续性控制规则（不绑定单一 UI）

连续性规则分四层：

1. 拓扑层：镜头连接有序且无环。
2. 视觉层：首尾帧、角色朝向、角色位置、构图锚点连续。
3. 音画层：台词时序、动作锚点、AV drift 在阈值内。
4. 合成层：转场合法、黑场间隙受控、依赖失效可追踪传播。

要求：以上规则可由时间线编辑器承载，也可由分镜链接与首尾帧流程承载，文档不强绑 UI 组件形态。

## 6.2.3 重跑影响面矩阵

1. shot 文案/参数修改：最小重跑范围为 `shot`。
2. shot 连接关系修改：最小重跑范围为 `adjacent shots + compose`。
3. clip 结构修改：最小重跑范围为 `clip + compose`。
4. episode 节奏修改：最小重跑范围为 `segmentation` 之后全链路。

## 6.2.4 版本与审计

每次创作操作必须记录：

1. `versionId`
2. `parentVersionId`
3. `branchId`
4. `operationType`
5. `deltaSummary`
6. `operator`
7. `timestamp`

规则：

1. `undo/redo` 仅在当前分支生效。
2. 分支合并必须产出冲突记录与裁决结果。

## 6.3 自动守卫规则（Guardrails & Regression）

## 6.3.1 禁止模式（必须硬闸）

1. mod 直连 vendor API。
2. 按模型名猜能力或硬编码 capability。
3. renderer 回写 narrative spine。
4. 绕开 canonical `CoreOutput` 作为事实输入。
5. 跳过必需 quality gate 直接生成 release package。

## 6.3.2 行为一致性守卫（新增）

1. 状态机单调性检查：禁止非法状态回退。
2. 幂等副作用检查：重复提交不得重复写产物。
3. 索引连续性检查：镜头/分镜 index 不得断裂或重复。
4. 跨实体引用检查：panel/voice/clip/episode 关系必须可解析。
5. 跨模块字段一致性检查：`CoreOutput` 变更必须触发 narrative-engine/textplay/videoplay 联动校验。

## 6.3.3 回归矩阵

1. route catalog 覆盖。
2. task type catalog 覆盖。
3. contract test mapping 覆盖。
4. resume/recovery 场景覆盖。
5. creator operations 场景覆盖。
6. prompt canary 覆盖。

## 6.4 Prompt 治理规则（独立合同）

1. 所有 prompt 必须有 `PromptID` 注册，不允许匿名模板。
2. 模板变量必须有 schema，渲染前强校验。
3. 结构化输出必须绑定 JSON shape 合同与必填字段。
4. 多语言模板占位符必须一致。
5. canary 固定输入集必须覆盖关键链路（故事、分镜、镜头重写、变体）。
6. canary 失败必须给出归因类型：模板变更、变量缺失、输出结构漂移、模型行为漂移。

## 7. 单次闭环交付清单（无阶段拆分）

同一轮交付必须同时完成：

1. 链路级 SSOT 三大域文档落地（run/creator/guard）。
2. narrative、textplay、videoplay 三模块执行合同与表源落地。
3. creator operations、continuity、impact、lineage、prompt governance 表源落地。
4. INDEX 导航更新，确保读路径闭环。
5. 证据文档落地并附生成/校验命令输出摘要。

## 8. 验收门禁（必须全部通过）

文档门禁：

1. 每个新增 contract 都有 rule id、table source、verification command。
2. SSOT 不包含执行态快照、打勾进度、日期化“通过/失败”状态。

命令门禁：

1. `pnpm -C nimi-mods run generate:spec`
2. `pnpm -C nimi-mods run check:spec`
3. 新增守卫命令入口（名称按仓库现有约定补充）：
   1. forbidden patterns lint
   2. route/task coverage check
   3. prompt canary check

证据门禁：

1. `dev/report/*evidence*.md` 记录本轮命令、结果、失败与修正。

## 9. 风险与控制

风险：

1. 规则写全了，但守卫脚本入口不落地，导致“只可读不可执行”。
2. 过度绑定时间线 UI，压缩了首尾帧与链接流程的实现自由度。
3. 对标照抄命名，破坏 Nimi 现有 `CREATE/MAINTAIN` 语义体系。
4. 超出当前链路能力边界的规则进入 SSOT，形成过度设计。

控制：

1. 每个规则必须绑定一条自动检查或回归用例。
2. 连续性规则采用“能力合同”表述，不绑定特定 UI 组件。
3. 迁移对标时只迁移机制，不迁移业务命名与 vendor 耦合字段。
4. 任何不映射当前接口/状态机/数据模型的规则，直接从本轮文档中删除。

## 10. 结论

Final State 版升级的核心不是“把文档写多”，而是把链路从“能生成”提升为“可运行、可恢复、可编辑、可守卫”。  
`world-studio` 已有运行与恢复经验，`narrative + textplay + videoplay` 已有规则骨架；本方案要求一次性把执行层与创作层合同补齐，形成可实施、可验证、可回归的完整文档基线。

---

## 11. 2026-03-02 五轮增量迭代计划（新增，不替代第 1-10 节）

说明：本节是 2026-03-02 当轮增量计划与执行记录，用于在不删除历史计划正文（第 1-10 节）的前提下，补充本轮新增机制和门禁闭环。

### 11.1 输入基线（最新仓库事实）

1. `world-studio` 当前存在真实 mod 实现（`nimi-mods/runtime/world-studio/src/*`）+ SSOT/spec。
2. `narrative-engine/textplay/videoplay` 当前为 SSOT/spec 与实现并行推进状态，`src` 运行实现已落地并可联调。
3. 链路级 SSOT 已有三份：
   1. `ssot/mod/worldstudio-narrative-rendering.md`
   2. `ssot/mod/worldstudio-narrative-chain-run-protocol.md`
   3. `ssot/mod/worldstudio-narrative-chain-guard-governance.md`
4. 项目未上线，严格 no-legacy/no-compat/no-migration shell。

### 11.2 对标输入（行业主流产品）

对标基线：外部行业样本仓，HEAD `eb18e92`（2026-03-01）。

高价值可迁移经验（拟吸收）：

1. 运行事件落库 + `seq` 增量补拉（`src/lib/run-runtime/service.ts`, `src/app/api/runs/[runId]/events/route.ts`）。
2. 断线恢复 `afterSeq` + `gap refill` 客户端补齐（`src/lib/query/hooks/run-stream/recovered-run-subscription.ts`）。
3. 任务去重与孤儿任务回收（`src/lib/task/service.ts` 的 `dedupeKey + orphan reconcile`）。
4. Prompt 注册与模板变量检查（`src/lib/prompt-i18n/*`）。
5. 路由/任务/需求三维行为测试矩阵与守卫（`tests/contracts/*`, `scripts/guards/*`）。

不应照抄、需显式防止的设计：

1. 用启发式 `stage` 字符串推断运行终态（脆弱）。
2. 把 `runId` 与 `taskId` 混同或别名化。
3. 将 `run.canceled` 归一为 `run.error`。
4. API 路由横向爆炸并与业务阶段 1:1 绑定，导致链路演进成本过高。

### 11.3 五轮执行清单（增量）

#### 11.3.1 第 1 轮：基线收敛与边界澄清

目标：

1. 把链路文档中的“设计目标”与“当前实现状态”明确分层，避免误读为已全部上线实现。
2. 清理“直接仿做”措辞，改为“机制借鉴 + 本地化约束”。

落地范围：

1. `ssot/mod/worldstudio-narrative-rendering.md`
2. 本计划文档与证据文档

门禁：

1. `pnpm -C nimi-mods run generate:spec`
2. `pnpm -C nimi-mods run check:spec`

#### 11.3.2 第 2 轮：Run 协议可恢复性强化

目标：

1. 在 narrative-engine/textplay run 合同内引入：
   1. `runId/taskId` 身份解耦规则
   2. `run.canceled` 独立终态语义
   3. `afterSeq + gap refill` 恢复读取约束

落地范围：

1. `nimi-mods/modules/narrative-engine/spec/kernel/run-orchestration-contract.md`
2. `nimi-mods/modules/narrative-engine/spec/kernel/tables/run-states.yaml`
3. `nimi-mods/modules/narrative-engine/spec/kernel/tables/reason-codes.yaml`
4. `nimi-mods/modules/narrative-engine/spec/kernel/tables/acceptance-cases.yaml`
5. `nimi-mods/runtime/textplay/spec/kernel/run-orchestration-contract.md`
6. `nimi-mods/runtime/textplay/spec/kernel/tables/run-states.yaml`
7. `nimi-mods/runtime/textplay/spec/kernel/tables/reason-codes.yaml`
8. `nimi-mods/runtime/textplay/spec/kernel/tables/acceptance-cases.yaml`

门禁：

1. `pnpm -C nimi-mods run generate:spec:narrative-engine-kernel-docs`
2. `pnpm -C nimi-mods run check:spec:narrative-engine`
3. `pnpm -C nimi-mods run generate:spec:textplay-kernel-docs`
4. `pnpm -C nimi-mods run check:spec:textplay`

#### 11.3.3 第 3 轮：链路反模式硬闸

目标：

1. 在链路级 SSOT 固化“反照抄”规则：
   1. 禁止启发式终态推断
   2. 禁止 run/task ID 混用
   3. 禁止 cancel 归一为 error
2. 在 videoplay prompt 治理补齐 catalog/template 漂移守卫。

落地范围：

1. `ssot/mod/worldstudio-narrative-chain-run-protocol.md`
2. `ssot/mod/worldstudio-narrative-chain-guard-governance.md`
3. `nimi-mods/runtime/videoplay/spec/kernel/prompt-governance-contract.md`
4. `nimi-mods/runtime/videoplay/spec/kernel/tables/prompt-canary-cases.yaml`

门禁：

1. `pnpm -C nimi-mods run generate:spec:videoplay-kernel-docs`
2. `pnpm -C nimi-mods run check:spec:videoplay`

#### 11.3.4 第 4 轮：WorldStudio -> Narrative 交接合同强化

目标：

1. 在 world-studio kernel 中补齐“对 narrative 可消费投影”的交接约束与验收案例。
2. 保持 worldstudio 提供基础事实、narrative-engine 编译叙事、renderer 消费渲染的主意图不变。

落地范围：

1. `nimi-mods/runtime/world-studio/spec/kernel/pipeline-contract.md`
2. `nimi-mods/runtime/world-studio/spec/kernel/tables/pipeline-states.yaml`
3. `nimi-mods/runtime/world-studio/spec/kernel/tables/reason-codes.yaml`
4. `nimi-mods/runtime/world-studio/spec/kernel/tables/acceptance-cases.yaml`

门禁：

1. `pnpm -C nimi-mods run generate:spec:world-studio-kernel-docs`
2. `pnpm -C nimi-mods run check:spec:world-studio`

#### 11.3.5 第 5 轮：全链路收敛与质量门禁闭环

目标：

1. 完成 SSOT 元数据门禁收敛（含 traceability）。
2. 汇总 5 轮证据并形成最终深度对比报告。

落地范围：

1. `ssot/_meta/traceability-matrix.md`
2. `dev/report/worldstudio-narrative-textplay-videoplay-doc-upgrade-evidence-2026-03-02.md`
3. 本计划文档（最终版）

门禁：

1. `pnpm run check:ssot-frontmatter`
2. `pnpm run check:ssot-links`
3. `pnpm run check:ssot-boundary`
4. `pnpm run check:ssot-traceability`
5. `pnpm -C nimi-mods run generate:spec`
6. `pnpm -C nimi-mods run check:spec`

### 11.4 全链路已落地资产总表（统一口径）

说明：本清单统一展示当前已落地资产，不区分“历史已落地”与“5 轮迭代已落地”来源。

1. 链路级 SSOT：
   1. `ssot/mod/worldstudio-narrative-rendering.md`
   2. `ssot/mod/worldstudio-narrative-chain-run-protocol.md`
   3. `ssot/mod/worldstudio-narrative-chain-guard-governance.md`
2. SSOT 元数据：
   1. `ssot/_meta/traceability-matrix.md`
3. World-Studio：
   1. `nimi-mods/runtime/world-studio/SSOT.md`
   2. `nimi-mods/runtime/world-studio/spec/kernel/pipeline-contract.md`
   3. `nimi-mods/runtime/world-studio/spec/kernel/acceptance-contract.md`
   4. `nimi-mods/runtime/world-studio/spec/kernel/tables/pipeline-states.yaml`
   5. `nimi-mods/runtime/world-studio/spec/kernel/tables/reason-codes.yaml`
   6. `nimi-mods/runtime/world-studio/spec/kernel/tables/acceptance-cases.yaml`
4. Narrative：
   1. `nimi-mods/modules/narrative-engine/spec/INDEX.md`
   2. `nimi-mods/modules/narrative-engine/spec/kernel/run-orchestration-contract.md`
   3. `nimi-mods/modules/narrative-engine/spec/kernel/tables/run-states.yaml`
   4. `nimi-mods/modules/narrative-engine/spec/kernel/tables/reason-codes.yaml`
   5. `nimi-mods/modules/narrative-engine/spec/kernel/tables/acceptance-cases.yaml`
5. TextPlay：
   1. `nimi-mods/runtime/textplay/spec/INDEX.md`
   2. `nimi-mods/runtime/textplay/spec/kernel/run-orchestration-contract.md`
   3. `nimi-mods/runtime/textplay/spec/kernel/tables/run-states.yaml`
   4. `nimi-mods/runtime/textplay/spec/kernel/tables/reason-codes.yaml`
   5. `nimi-mods/runtime/textplay/spec/kernel/tables/acceptance-cases.yaml`
6. VideoPlay：
   1. `nimi-mods/runtime/videoplay/spec/INDEX.md`
   2. `nimi-mods/runtime/videoplay/spec/kernel/creator-workflow-contract.md`
   3. `nimi-mods/runtime/videoplay/spec/kernel/version-lineage-contract.md`
   4. `nimi-mods/runtime/videoplay/spec/kernel/prompt-governance-contract.md`
   5. `nimi-mods/runtime/videoplay/spec/kernel/tables/creator-operations.yaml`
   6. `nimi-mods/runtime/videoplay/spec/kernel/tables/rebuild-impact-matrix.yaml`
   7. `nimi-mods/runtime/videoplay/spec/kernel/tables/continuity-constraints.yaml`
   8. `nimi-mods/runtime/videoplay/spec/kernel/tables/version-lineage-policy.yaml`
   9. `nimi-mods/runtime/videoplay/spec/kernel/tables/forbidden-patterns.yaml`
   10. `nimi-mods/runtime/videoplay/spec/kernel/tables/prompt-canary-cases.yaml`
7. 过程文档：
   1. `dev/plan/worldstudio-narrative-textplay-videoplay-doc-upgrade-plan-2026-03-02.md`
   2. `dev/report/worldstudio-narrative-textplay-videoplay-doc-upgrade-evidence-2026-03-02.md`

### 11.5 机制级变更说明（问题 -> 机制 -> 提升 -> 落点）

| 机制 | 解决的问题 | 提升 | 落点 |
|---|---|---|---|
| 链路 contract-first 边界 | 容易把“文档目标”误读成“运行实现已全部上线” | 先定义可验证合同，再推进实现，避免临时行为反向定义规则 | `ssot/mod/worldstudio-narrative-rendering.md` |
| 统一 RunEvent 信封（traceId/runId/stage/step/seq/attempt/eventType） | 跨 world-studio/narrative-engine/textplay/videoplay 运行语义不统一 | 全链路事件可对齐、可追踪、可恢复 | `ssot/mod/worldstudio-narrative-chain-run-protocol.md` |
| run/task 身份解耦 | 把执行实例和任务单混成一个 ID，导致恢复与审计歧义 | 运行态与调度态职责分离，关联明确 | `ssot/mod/worldstudio-narrative-chain-run-protocol.md` + narrative-engine/textplay `run-orchestration-contract.md` |
| cancel 独立终态（`run.canceled -> CANCELED`） | 用户主动取消被误记为失败，影响统计与重试决策 | 取消、失败、完成三种终态语义清晰 | `ssot/mod/worldstudio-narrative-chain-run-protocol.md` + narrative-engine/textplay `reason-codes.yaml` |
| 禁止启发式终态推断 | 依赖 stage/message 文本猜终态，脆弱且不可验证 | 终态只由显式事件决定，降低误判 | `ssot/mod/worldstudio-narrative-chain-run-protocol.md` + `ssot/mod/worldstudio-narrative-chain-guard-governance.md` |
| `afterSeq + gapRefill` 恢复协议 | 断线后事件断档，客户端无法确定是否漏事件 | 先补洞再续流，恢复过程确定性更高 | `ssot/mod/worldstudio-narrative-chain-run-protocol.md` + narrative-engine/textplay `run-states.yaml` |
| 结构化失败分流（`reasonCode + actionHint + retryClass`） | 错误提示不可执行，重试策略不一致 | 失败可操作、可路由、可自动化处理 | `ssot/mod/worldstudio-narrative-chain-run-protocol.md` |
| world -> narrative 交接投影束（`WS-PIPE-008`） | 发布后交接字段缺失/漂移，narrative ingest 失败或靠猜测 | 发布阶段 fail-close，保证下游可消费最小字段完整 | world-studio `pipeline-contract.md` + `pipeline-states.yaml` + `acceptance-cases.yaml(WS-013)` |
| prompt catalog/template 漂移守卫（`V-PROMPT-006`） | 模板与注册表不一致导致运行期才爆错 | 漂移在 canary 阶段前置拦截 | videoplay `prompt-governance-contract.md` + `prompt-canary-cases.yaml` |
| 反照抄硬闸 | 外部工程模式被直接复制进本链路，破坏主意图和边界 | 仅迁移机制，不迁移耦合字段/路由拆分习惯/启发式逻辑 | `ssot/mod/worldstudio-narrative-chain-guard-governance.md` |
| 创作操作闭环（已落地并保留） | 分镜编辑能力零散、回放与审计难闭环 | 插镜头/变体/重生成/撤销/分支等操作合同化 | videoplay `creator-workflow-contract.md` + `creator-operations.yaml` |
| 连续性约束（已落地并保留） | 镜头衔接、时序、依赖关系易断裂 | 连续性问题可规则化检查，不依赖单一 UI 形态 | videoplay `continuity-constraints.yaml` |
| 重跑影响面矩阵（已落地并保留） | 任一改动都全量重跑，成本高、结果不可预期 | 按 shot/clip/episode 精确控制重跑扩散 | videoplay `rebuild-impact-matrix.yaml` |
| 版本谱系与分支策略（已落地并保留） | 创作历史不可追踪，回退和合并语义不清 | 版本 lineage、分支语义、审计链清晰 | videoplay `version-lineage-contract.md` + `version-lineage-policy.yaml` |
| SSOT traceability 收敛 | SSOT 文档存在但未登记矩阵，门禁失败 | 规范索引与门禁一致，防止“隐形 SSOT” | `ssot/_meta/traceability-matrix.md` |

### 11.6 本轮机制落地的直接效果

1. world-studio 到 narrative 的交接从“口头约定”变成“字段级硬合同”。
2. narrative-engine/textplay 的运行终态与恢复行为从“实现习惯”变成“可验证协议”。
3. videoplay 的 prompt 风险从“运行期暴露”前移到“canary 阶段阻断”。
4. 全链路规则、表源、验收、reason-code、门禁形成闭环，减少文档与实现漂移。

### 11.7 五轮执行记录（2026-03-02）

1. 第 1 轮完成：
   1. 计划文档重构为 5 轮执行结构。
   2. 链路 SSOT 补充 contract-first 边界，防止“临时行为替代合同”。
   3. `pnpm -C nimi-mods run generate:spec` 通过；`pnpm -C nimi-mods run check:spec` 通过。
2. 第 2 轮完成：
   1. narrative-engine/textplay run 合同与表新增 `run/task 解耦`、`cancel 终态独立`、`afterSeq+gap refill`。
   2. narrative-engine/textplay reason-codes 与 acceptance 同步补充。
   3. 两模块生成与一致性门禁均通过。
3. 第 3 轮完成：
   1. 链路级 SSOT 增加反照抄硬闸（反启发式终态推断、反 run/task 别名、反 cancel->error）。
   2. videoplay prompt 治理增加 catalog/template drift guard。
   3. videoplay 生成与一致性门禁通过。
4. 第 4 轮完成：
   1. world-studio 增补 narrative handoff projection 合同、reason-code 与 acceptance。
   2. world-studio 生成与一致性门禁通过。
5. 第 5 轮完成：
   1. SSOT traceability 缺口已补齐（3 个链路级 SSOT 条目）。
   2. 全量 ssot/spec 门禁通过，证据文档已完成更新。
