---
title: WorldStudio-Narrative Chain Guard Governance SSOT
status: ACTIVE
version: v1.0
updated_at: 2026-03-02
rules:
  - 本文件定义 `world-studio -> narrative -> textplay|videoplay` 跨阶段守卫与回归门禁。
  - 禁止模式必须通过自动检查执行，不得只保留文档约定。
  - 任何借鉴外部工程的规则都必须先通过“链路意图一致性审查”，不得把外部系统耦合点直接迁入本链路。
  - 任一规则若无法映射到当前接口、状态机或数据模型，视为过度设计并删除。
  - 项目未上线，不引入兼容层守卫或 legacy 双轨门禁。
---

# WorldStudio-Narrative 链路守卫治理

## 1. 目标与范围

目标：把“规则”变成“自动守卫”，确保改动后不会发生行为回退。

范围：

1. world-studio 发布到 narrative 的输入契约。
2. narrative 到 textplay/videoplay 的事实投影契约。
3. renderer 的创作操作、重跑影响与质量门禁契约。

## 2. 禁止模式（MUST）

必须阻断的模式：

1. mod 直连 vendor API。
2. 通过模型名猜能力或硬编码 capability。
3. renderer 回写 narrative spine。
4. 绕过 canonical `CoreOutput` 输入事实。
5. 跳过强制 quality gate 直接生成 release package。
6. 通过 `stage/message` 文本启发式推断 run 终态。
7. `runId` 与 `taskId` 别名复用。
8. 将 `run.canceled` 归一成 `run.error`。

## 3. 行为一致性守卫（MUST）

必须自动检查：

1. 状态机单调性：终态不可回退。
2. 幂等副作用：同 `idempotencyKey` 不得重复写。
3. 索引连续性：shot/panel index 不得断裂或重复。
4. 引用完整性：clip/shot/voice/episode 关系可解析。
5. 字段联动一致性：`CoreOutput` 变更必须触发 narrative/textplay/videoplay 联动校验。

## 4. 回归矩阵（MUST）

最小回归维度：

1. route catalog 覆盖。
2. task type catalog 覆盖。
3. contract test mapping 覆盖。
4. resume/recovery 场景覆盖。
5. creator operations 场景覆盖。
6. prompt canary 场景覆盖。

执行证据要求：

1. 覆盖矩阵必须落地为机器可读资产（route/tasktype/requirements）。
2. 每个矩阵项必须能回链到实际测试文件，缺失即门禁失败。
3. 不允许“源码字符串包含断言”替代行为测试断言。

## 5. Prompt 治理基线（MUST）

1. 模板必须有稳定 `PromptID`。
2. 模板变量必须有 schema，并在渲染前校验。
3. 结构化输出必须有 JSON shape 合同。
4. 多语言模板占位符必须一致。
5. canary 固定输入集必须覆盖故事、分镜、镜头重写、变体。

## 6. 裁决顺序

冲突裁决优先级：

1. `ssot/mod/worldstudio-narrative-rendering.md`（链路边界）
2. `ssot/mod/worldstudio-narrative-chain-run-protocol.md`（运行协议）
3. 本文件（守卫治理）
4. 各模块 SSOT/spec（模块细则）

同级冲突时，自动守卫可执行性优先于叙述完整性。

## 7. 反照抄裁决（MUST）

1. 外部项目中的路由拆分方式、数据库字段形态、日志习惯不构成可迁移合同。
2. 仅以下三类内容可迁移：协议机制、恢复机制、测试治理机制。
3. 任一提案若同时破坏“worldstudio 提供事实 / narrative 编译叙事 / renderer 消费渲染”主意图，必须驳回。
