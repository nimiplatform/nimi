# World-Studio -> Narrative -> TextPlay -> VideoPlay 文档升级方案（Final State 版）

日期：2026-03-02  
作者：Codex（基于仓库现状与外部工程样本代码审读）

## 1. 目标与边界

本方案只定义一个目标状态：一次性补齐 `world-studio -> narrative -> textplay -> videoplay` 全链路文档合同，不引入阶段性中间态。

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

1. `nimi-mods/world-studio/SSOT.md`（UPDATE）  
   作用：强化对 narrative 可消费投影契约与 trace 完整性要求。
2. `nimi-mods/narrative/spec/kernel/run-orchestration-contract.md`（ADD）
3. `nimi-mods/narrative/spec/kernel/tables/run-states.yaml`（ADD）
4. `nimi-mods/textplay/spec/kernel/run-orchestration-contract.md`（ADD）
5. `nimi-mods/textplay/spec/kernel/tables/run-states.yaml`（ADD）
6. `nimi-mods/videoplay/spec/kernel/creator-workflow-contract.md`（ADD）
7. `nimi-mods/videoplay/spec/kernel/version-lineage-contract.md`（ADD）
8. `nimi-mods/videoplay/spec/kernel/prompt-governance-contract.md`（ADD）
9. `nimi-mods/videoplay/spec/kernel/tables/creator-operations.yaml`（ADD）
10. `nimi-mods/videoplay/spec/kernel/tables/rebuild-impact-matrix.yaml`（ADD）
11. `nimi-mods/videoplay/spec/kernel/tables/continuity-constraints.yaml`（ADD）
12. `nimi-mods/videoplay/spec/kernel/tables/version-lineage-policy.yaml`（ADD）
13. `nimi-mods/videoplay/spec/kernel/tables/forbidden-patterns.yaml`（ADD）
14. `nimi-mods/videoplay/spec/kernel/tables/prompt-canary-cases.yaml`（ADD）
15. `nimi-mods/videoplay/spec/INDEX.md`（UPDATE）
16. `nimi-mods/narrative/spec/INDEX.md`（UPDATE）
17. `nimi-mods/textplay/spec/INDEX.md`（UPDATE）

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
3. `stage`（world-studio | narrative | textplay | videoplay）
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
5. 跨模块字段一致性检查：`CoreOutput` 变更必须触发 narrative/textplay/videoplay 联动校验。

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
