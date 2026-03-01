---
title: WorldStudio-Narrative Chain Run Protocol SSOT
status: ACTIVE
version: v1.0
updated_at: 2026-03-02
rules:
  - 本文件定义 `world-studio -> narrative -> textplay|videoplay` 跨 mod 统一运行协议。
  - 事件协议固定为 `run/step/chunk` 分层；任一实现不得跳过 `seq` 单调性与幂等语义。
  - 中断恢复必须依赖 `runSnapshot + checkpointToken + lastAckedSeq`，不得以“整链重跑”替代协议恢复。
  - 失败分流必须输出结构化 `reasonCode + actionHint + retryClass`，不得返回不可操作错误。
  - 项目未上线，不引入 legacy 运行协议兼容层。
---

# WorldStudio-Narrative 链路统一运行协议

## 1. 目标与范围

本文件约束四段链路在运行时的统一行为：

1. `world-studio` 资产生成/维护任务。
2. `narrative` 回合编译任务。
3. `textplay` 文本渲染任务。
4. `videoplay` 分集生产任务。

不属于本文件：

1. 各模块内部算法与 UI 细节。
2. runtime 的模型/供应商治理细节。

## 2. 统一 RunEvent 模型（MUST）

所有阶段统一事件信封字段：

1. `traceId`
2. `runId`
3. `parentRunId`（可空）
4. `stage`（`world-studio|narrative|textplay|videoplay`）
5. `step`
6. `eventType`（`run.start|step.start|step.chunk|step.complete|step.error|run.complete|run.error|run.canceled`）
7. `seq`（单调递增，不允许回退）
8. `attempt`（同一 step 的重试序号）
9. `timestamp`

条件必填：

1. 写操作事件必须携带 `idempotencyKey`。
2. 可恢复 step 事件必须携带 `checkpointToken`、`stepInputHash`、`lastCompletedUnit`。
3. 失败事件必须携带 `reasonCode`、`actionHint`、`retryClass`。

## 3. 运行状态机（MUST）

统一运行态：

1. `RUNNING`
2. `PAUSE_REQUESTED`
3. `PAUSED`
4. `CANCEL_REQUESTED`
5. `CANCELED`
6. `FAILED`
7. `COMPLETED`

硬约束：

1. 终态（`CANCELED|FAILED|COMPLETED`）不可回退。
2. `step.complete` 之后允许新 `attempt`，但必须递增且保留原 attempt 轨迹。
3. 同一 `idempotencyKey` 重放不得产生重复副作用。

## 4. 中断恢复协议（MUST）

恢复输入最小集合：

1. `runSnapshot`（每个 step 的稳定状态与恢复指针）
2. `lastAckedSeq`（客户端已确认序号）
3. `checkpointToken`
4. `stepInputHash`

恢复流程：

1. 服务端先验证 `stepInputHash`，不一致直接 `FAILED`。
2. 若 `seq` 断档，必须先执行 `gapRefill` 补拉缺失事件，再恢复流式推送。
3. 对迟到 chunk 执行 `attemptCanonicalization`，归并到对应 attempt，禁止污染最终态。
4. 若 step 不可恢复，必须 fail-close 并给出可执行 `actionHint`。

## 5. 失败分类与动作分流（MUST）

`retryClass` 只允许：

1. `retryable`：route unavailable、provider timeout、短暂解析错误。
2. `non-retryable`：contract violation、forbidden pattern、canonical fact mismatch。

用户可执行动作固定为：

1. `continue-from-checkpoint`
2. `rerun-step`
3. `cancel-run`

禁止返回“稍后再试”这类无操作语义提示。

## 6. 链路可观测最小字段（MUST）

跨阶段追踪最小字段：

1. `traceId`
2. `runId`
3. `stage`
4. `step`
5. `seq`
6. `reasonCode`
7. `actionHint`
8. `idempotencyKey`（写操作）

任何阶段缺失上述字段都视为协议违规。

## 7. 与模块合同关系

1. narrative 运行细节：`nimi-mods/narrative/spec/kernel/run-orchestration-contract.md`
2. textplay 运行细节：`nimi-mods/textplay/spec/kernel/run-orchestration-contract.md`
3. videoplay 创作与重跑影响：`nimi-mods/videoplay/spec/kernel/creator-workflow-contract.md`
4. 跨阶段守卫治理：`ssot/mod/worldstudio-narrative-chain-guard-governance.md`
