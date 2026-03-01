---
title: World Studio -> Narrative -> Rendering Chain SSOT
status: ACTIVE
version: v1.2
updated_at: 2026-03-01
rules:
  - 本文件定义跨 mod 编排契约，不替代各业务 mod 的单体 SSOT。
  - 产品主链固定为 `world-studio -> narrative -> renderer`，其中 renderer 可为 textplay 或 videoplay。
  - realm world+agent 是唯一基础事实源；Narrative 是唯一叙事事实层；renderer 只能消费叙事事实投影，不得改写任何事实层。
  - world-studio 只负责世界资产生产与维护，不直接承担叙事回合执行。
  - 渲染通道（text/video）必须共享 Narrative canonical `CoreOutput` 事实流；videoplay 可按 episode 聚合消费，但禁止双事实链分叉。
  - textplay 作为正式 renderer 分支，固定执行链为 `received -> normalize -> filter-visibility -> build-prompt -> generate -> wrap-output -> persist-best-effort`。
  - `NarrativeContext` 仅承载叙事控制变量（setting/state）；world/agent 事实正文必须由 narrative Step1 运行时读取，不得回填到 NarrativeContext。
  - videoplay 作为正式 renderer 分支，固定执行链为 `narrative-ingest -> episode-segmentation -> screenplay -> storyboard -> asset-render -> edit-compose -> qc-gate -> release-package`。
  - renderer 产物必须携带 `sourceEventIds`，可追溯到 `CoreOutput.spineEvents`。
  - 编排层失败语义必须统一为 `reasonCode + actionHint`，并可跨 stage 追踪。
  - 不考虑 legacy 兼容，按 final-state 一次性定义契约。
---

# World Studio -> Narrative -> Rendering 链路契约

## 1. 目标与范围

本文件约束三层协作：

1. `world-studio`：生产世界知识资产（World/Worldview/Events/Lorebooks）。
2. `narrative`：把世界资产 + agent 关系连续性编译成回合事实。
3. `renderer`：把事实投影渲染为用户可消费内容（文本或视频）。

本文件不定义：

1. 各 mod 内部实现细节（见各自 SSOT）。
2. realm 私有治理算法。

## 2. 固定阶段与职责

### Stage A: world-studio（创作与维护）

输入：

1. Creator 素材输入
2. WorldAccessControl
3. AI route 配置

输出（发布后）：

1. `World + Worldview`
2. `WorldEvent[]`（PRIMARY/SECONDARY）
3. `WorldLorebook[]`
4. `WorldMutation[]`（审计流）

### Stage B: narrative（事实生成）

输入：

1. `TurnInput`（storyId + triggerSource + message/systemPayload）
2. Stage A 产出的 world 资产（读）
3. agent 语义资产（profile + memory + NarrativeContext(setting/state)）

输出：

1. `TurnResult`
2. 成功态中的 `CoreOutput`
3. spine append-only 事实写入与审计

NarrativeContext 正式 scope 字段：

1. `CANON`：`revealPolicy/spoilerPolicy/pacingPolicy/initiativePolicy`
2. `STORY`：`arcContract/povPolicy/castPolicy + phase/tension/openThreads`
3. `SUBJECT`：`dramaticRole/longTermObjective/hiddenAgenda/decisionPolicy + activeObjective/emotionalState/pressure`
4. `RELATION`：`relationContract/disclosurePolicy + trust/hostility/dependency/intimacy/trend`

### Stage C: renderer（表现输出）

可选分支：

1. `textplay`：输出沉浸文本
2. `videoplay`：输出分集短剧发布包（master video + poster + caption + metadata + trace）

硬约束：

1. renderer 只能读取 `CoreOutput` 投影。
2. renderer 不能写入 narrative spine。

## 3. 统一事实接口（跨 text/video）

### 3.1 Canonical Fact Payload

1. `CoreOutput.spineEvents[]`
2. `CoreOutput.stateChanges`
3. `CoreOutput.metrics`

### 3.2 Renderer Input Projection

所有 renderer 必须从 `CoreOutput` 派生本模态输入，至少包含：

1. `events`（来自 `spineEvents`）
2. `triggerSource`
3. `userMessage/systemContext`
4. `worldStyle`
5. `agent/player/scene anchor`
6. `metrics`
7. `sourceEventIds`（渲染计划中每个 beat/shot 的事实追溯键）

## 4. TextPlay 与 VideoPlay 分工

### 4.1 TextPlay（正式）

1. 输出文本散文/对话体验。
2. 强制执行 visibility + POV 约束。
3. 固定执行主链：`received -> normalize -> filter-visibility -> build-prompt -> generate -> wrap-output -> persist-best-effort`。

### 4.2 VideoPlay（正式）

1. 输出镜头级结构（shot plan / beat / style prompt / motion cue）。
2. 以 `CoreOutput` 为事实锚点，不得增加世界事实。
3. 允许在表现层补充镜头语法字段（camera/motion/lens），但这些字段不回写 Narrative。
4. 固定执行主链：`narrative-ingest -> episode-segmentation -> screenplay -> storyboard -> asset-render -> edit-compose -> qc-gate -> release-package`。
5. 每个 beat/shot 必须携带 `sourceEventIds`，并可回溯到输入 `spineEvents`。
6. `groundedRatio` 与 `assetCoverageRatio` 未达门槛时必须 fail-close。
7. 产线交付单位固定为 episode，不是单回合片段；发布包必须包含 video+poster+caption+metadata+trace 最小集。

### 4.3 Text/Video 一致性

1. 同一 narrative turn 只能有一份 canonical `CoreOutput`；textplay 可按 turn 直接消费，videoplay 可按分集窗口聚合消费。
2. 允许表现风格差异（文字 vs 视频），不允许事实差异（事件集合与可见性约束）。
3. 双 renderer 都必须通过 visibility + POV 约束，不得在任一模态泄漏 internal 非玩家事件。

## 5. 编排层统一失败语义

### 5.1 统一错误信封

1. `reasonCode: string`
2. `actionHint: string`
3. `stage: world-studio | narrative | renderer`
4. `traceId: string`

### 5.2 最小跨阶段 reasonCode

1. `CHAIN_WORLD_CONTEXT_UNREADY`
2. `CHAIN_AGENT_CONTEXT_UNREADY`
3. `CHAIN_NARRATIVE_REJECTED`
4. `CHAIN_RENDER_INPUT_INVALID`
5. `CHAIN_RENDER_ROUTE_UNAVAILABLE`
6. `CHAIN_RENDER_FAILED`

## 6. 与 realm world+agent 的对齐原则

1. 世界事实来源唯一：realm world control-plane 资产（events/lorebooks/worldview）。
2. 关系连续性来源唯一：realm agent + memory 资产。
3. Narrative 编译层负责把 realm 资产（worldview rules + world events + world lorebooks + agent rules + agent lorebooks）与 NarrativeContext scope 投影合并，产出 renderer 可消费上下文。
4. renderer 不直连 realm 领域写入接口。

## 7. 验收门禁（链路级）

1. world-studio 发布资产可被 narrative step1 直接消费（无 legacy 适配层）。
2. narrative 输出对 textplay 与 videoplay 输入均可稳定投影。
3. text/video 双 renderer 对同一 turn 不产生事实分叉。
4. 任一阶段失败均返回结构化 `reasonCode + actionHint + stage`。
5. traceId 可贯通 stage A/B/C，支持端到端审计。
6. videoplay 输出的 beat/shot 必须全量可追溯到 `sourceEventIds`。
7. videoplay 的 `groundedRatio` 与 `assetCoverageRatio` 需满足其 SSOT 门槛定义。
8. videoplay 必须支持“连续叙事输入 -> 分集产出”闭环，且分集可独立发布。
9. videoplay 任一分集中的 beat/shot 都必须可回溯到被聚合 turn 的 `sourceEventIds`。

## 8. 引用关系

1. world-studio：`@nimiplatform/nimi-mods/world-studio/SSOT.md`
2. narrative：`@nimiplatform/nimi-mods/narrative/SSOT.md`
3. textplay：`@nimiplatform/nimi-mods/textplay/SSOT.md`
4. videoplay：`@nimiplatform/nimi-mods/videoplay/SSOT.md`
5. videoplay spec import index：`@nimiplatform/nimi-mods/videoplay/spec/index.yaml`
6. videoplay 分集切分契约：`@nimiplatform/nimi-mods/videoplay/spec/contracts/episode-segmentation.yaml`
7. videoplay 剪辑合成契约：`@nimiplatform/nimi-mods/videoplay/spec/contracts/edit-compose.yaml`
8. mod 通用治理：`@nimiplatform/nimi/ssot/mod/governance.md`
9. world 边界桩：`@nimiplatform/nimi/ssot/boundaries/world.md`
10. agent 边界桩：`@nimiplatform/nimi/ssot/boundaries/agent.md`
