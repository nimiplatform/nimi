# Runtime Multimodal Provider Guide

## 1. 目标与边界
Anchors: K-MMPROV-001, K-MMPROV-006, K-MMPROV-012

本指南解释多模态提供者层的阅读顺序和实现关注点，不定义新规则。

## 2. Canonical 输入理解
Anchors: K-MMPROV-001, K-MMPROV-002, K-MMPROV-003, K-MMPROV-004, K-MMPROV-005

先确定 common 头字段，再按模态校验专属字段。字段事实源见 `multimodal-canonical-fields.yaml`。

## 3. 异步任务与 Artifact
Anchors: K-MMPROV-006, K-MMPROV-007

视频与长音频必须优先走异步任务语义，artifact 字段由 `multimodal-artifact-fields.yaml` 统一治理。

## 4. Adapter 与路由
Anchors: K-MMPROV-008, K-MMPROV-009, K-MMPROV-010

provider 适配层要做到请求映射、响应归一化、错误归一化；路由决策必须可观测。

## 5. Workflow 与交付门
Anchors: K-MMPROV-011, K-GATE-040, K-GATE-060

workflow external async 与媒体任务状态机应保持一致，并通过交付门矩阵验证。
