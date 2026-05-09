# 流程演示

下面是一个虚构但贴近现实的 Nimi Coding topic，从开始走到结束。它不是仓库里真实存在的 topic，只是一个用来演示完整流程的示例。

## 背景

某团队要把认证服务从只用 JWT 迁移到 JWT 加 session bearer 双轨。这次变更触及权威契约、运行时执行和 SDK 接口投射，正是方法论想要覆盖的跨域工作。

下面追踪这个 topic 从 `proposal` 走到 `closed` 的完整过程。

## 阶段 1：创建 topic（`proposal`）

团队主程写下一个 topic。

`topic.yaml`（初始）：

```yaml
topic_id: 2026-06-15-auth-jwt-plus-session-migration
state: proposal
created_at: 2026-06-15
last_transition_at: 2026-06-15
last_transition_reason: topic_created
title: Auth JWT-Plus-Session Migration
mode: landed
posture: no_legacy_hard_cut
design_policy: complete_contract_first
parallel_truth: forbidden
layering: ontology
risk: high
applicability: high_risk_refactor
entry_justification: |
  Migrate auth from JWT-only to JWT+session bearer. Touches
  authority contract (P-AUTH-*), runtime execution
  (K-AUTH-*), SDK projection (S-ERROR-*). Backward-compat
  path is hard-cut; legacy alias is forbidden.
execution_mode: manager_worker_auditor
selected_next_target: null
current_true_close_status: not_started
forbidden_shortcuts:
  - mvp_subset_contract
  - legacy_alias
  - compat_shim
  - dual_read
  - dual_write
  - placeholder_success
  - happy_path_only_closure
  - time_phased_layering
  - app_local_shadow_truth
  - silent_owner_cut_reopen
waves: []
```

topic 已存在，但还没有 wave。

## 阶段 2：设计（仍在 `proposal`）

团队写出 `design.md`，明确这次迁移要做成什么形态。设计中点明：

- 新引入的 `SessionBearer` 契约。
- 已有的 `JWT` 与新 `SessionBearer` 之间的关系：以显式双真相准入登记，并约定切换日期，不走静默的 `legacy_alias`。
- 这次迁移必须满足的四闭合条件。

## 阶段 3：准入 wave-1（`proposal → ongoing`）

团队准入第一个 wave。

```yaml
- wave_id: wave-1-auth-spec-update
  slug: auth-spec-update
  state: admitted
  primary_closure_goal: |
    Update `.nimi/spec/runtime/kernel/auth-service.md` and
    `.nimi/spec/sdk/kernel/error-projection.md` to admit the
    SessionBearer contract alongside JWT. Explicit
    dual-admission with cutover date.
  deps: []
  owner_domain: .nimi/spec/runtime/kernel/auth-service.md and .nimi/spec/sdk/kernel/error-projection.md
  parallelizable_after: stable_authority_contract
  selected: true
```

topic 状态从 `proposal` 转入 `ongoing`，`selected_next_target` 指向 wave-1。

## 阶段 4：实施前的权威收敛

wave-1 是 `spec` packet（触及 `.nimi/spec/`）。权威收敛闸门触发。

manager 启动一次独立审计（另一个 AI 会话）：

| 结果类型 | audit |
| 判定 | PASS |
| 发现 | 无阻断项 |

manager 记录审计结果。wave-1 现在可以派发。

## 阶段 5：冻结 wave-1 packet 并派发 worker

packet 冻结，写明允许的读、允许的写、验收恒定式、负面测试、停止线和重开条件。

worker（AI 宿主）在 packet 边界内执行：

- 读取 `.nimi/spec/runtime/kernel/auth-service.md`。
- 修改文件，准入 `SessionBearer` 契约。
- 读取 `.nimi/spec/sdk/kernel/error-projection.md`。
- 修改文件，新增 SessionBearer 的 error reason code。
- 抵达 packet 边界即停，不动其他表面。

## 阶段 6：实施后的判定

独立回路对实施结果做复核。

| 结果类型 | judgement |
| 判定 | PASS |
| 发现 | 无阻断项 |

wave-1 进入 closeout 阶段。

## 阶段 7：wave-1 closeout（四闭合）

| 维度 | 判定 | 证据 |
| --- | --- | --- |
| 权威闭合 | closed | 规范属主唯一，未引入并行真相 |
| 语义闭合 | closed | SessionBearer 必填字段、失败模式已锁定 |
| 消费方闭合 | closed | App 开发者可读 SessionBearer 契约；runtime 与 SDK 对齐 |
| 抗漂移闭合 | closed | 已声明禁用 `legacy_alias`、`compat_shim`、`dual_read`、`dual_write`；重开条件显式 |

wave-1 关闭。topic 仍在 `ongoing`，因为还有后续 wave。

## 阶段 8：准入 wave-2（runtime 实现）

wave-2 按新规范实现 runtime auth-service 的改动。

```yaml
- wave_id: wave-2-runtime-auth-implementation
  slug: runtime-auth-implementation
  state: admitted
  primary_closure_goal: |
    Implement SessionBearer issuance and validation in
    runtime auth-service. JWT path stays operational under
    explicit dual-truth admission per wave-1.
  deps:
    - wave-1-auth-spec-update
  owner_domain: runtime/internal/auth/**
```

wave-2 是 `implementation` packet（不触及 `.nimi/spec/`），权威收敛闸门不触发。wave-2 可以直接派发。

## 阶段 9：wave-2 出现 OVERFLOW

实施过程中，worker 在未完成的状态下抵达 packet 边界。所有权域并未被越过，方向仍然正确，也没有引入影子真相。

| 结果 | OVERFLOW |
| 原因 | packet 边界划得过窄 |

manager 评估：是否允许续作？答案是允许（方向正确、影响范围可控、没有影子真相、无需回退）。

manager 准入一份续作 packet，扩大边界。worker 继续。

## 阶段 10：wave-2 closeout

续作完成后，wave-2 走完四闭合（PASS）并关闭。

## 阶段 11：wave-3（SDK 投射）

wave-3 让 SDK 暴露新的 SessionBearer error reason code。

经过派发、审计、closeout，关闭并 PASS。

## 阶段 12：topic 进入 pending

所有准入的 wave 都已关闭。机械上看迁移已经完成。但团队希望先在生产环境观察一个完整发布周期，再宣告 true close。

topic 状态从 `ongoing` 转入 `pending`，并附带显式 `pending-note`：

```yaml
reason: awaiting-deployment-observation
close_trigger: One full release cycle observed without
  SessionBearer regression
reopen_criteria: SessionBearer regression observed; admit
  remediation wave under this topic
```

## 阶段 13：pending 解除，true close

一个发布周期之后没有回归。团队触发 true close。

| 步骤 | 动作 |
| --- | --- |
| 1. topic-true-close-audit | 独立审计确认四个闭合在生产环境观察下均成立 |
| 2. result-topic-true-close | 已记录 |
| 3. `topic.yaml` 更新 | `state: pending → closed`；`current_true_close_status: not_started → true_closed`；`last_transition_reason: topic_true_close_passed` |
| 4. 文件夹迁移 | `.nimi/topics/pending/2026-06-15-auth-jwt-plus-session-migration/` → `.nimi/topics/closed/2026-06-15-auth-jwt-plus-session-migration/` |

## 这次演示展示了什么

| 性质 | 在本次演示中如何体现 |
| --- | --- |
| 权威被显式命名 | topic 写明 `forbidden_shortcuts`、`owner_domain`、`parallel_truth` 立场 |
| 执行被 packet 化 | 每个 wave 都有自己的 packet，写明允许的读 / 写 |
| 闭合是多维的 | wave-1 的 closeout 写出四个独立维度 |
| 角色被分离 | manager 准入，worker 执行，独立 auditor 复核 |
| 权威收敛 | 涉及规范的 wave 强制要求实施前审计 + 实施后判定 |
| 禁用反模式 | 在 packet 层声明，由审计核查 |
| OVERFLOW 与 PASS | wave-2 触发 OVERFLOW，按显式条件续作 |
| true close 不等于 wave 关闭 | wave 全部关闭后 topic 仍处于 pending；true close 需要单独审计 |
| pending 状态 | 用于"等待生产环境观察"，重开条件强类型化 |

每一项都对应包内已准入的机制。

## 这次演示没有展示什么

| 关注点 | 略过原因 |
| --- | --- |
| 真实的认证代码 | 不在文档范围内 |
| 用了哪个 provider / 哪个模型 | 宿主无关，对方法论而言不影响 |
| CI 管线 | 属于 DevOps 层，不属于 Nimi Coding 层 |
| 行级 diff | 方法论纪律在 wave 级，不在行级 |

## 来源依据

- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic.schema.yaml)
- [`.nimi/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/wave.schema.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/closeout.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/closeout.schema.yaml)
