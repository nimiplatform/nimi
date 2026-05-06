# 走查

这一页是一次合成的 Nimi Coding topic 全流程演示 —— 一个虚构但贴近真实的例子。它不是仓库里的真 topic，只是为了演示完整流程造出来的。

## 设定

一个团队要把认证服务从 JWT-only 迁到 JWT 加 session-bearer。这次改动碰到的是权威合同、runtime 执行、客户端 SDK 这几条边界。这正是方法论要应对的跨域工作。

我们陪这个 topic 从 `proposal` 走到 `closed`。

## 阶段 1：Topic 创建（`proposal`）

团队的 lead engineer 写一份 topic。

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
  从 JWT-only 迁到 JWT+session bearer。改动碰到权威合同
  （P-AUTH-*）、runtime 执行（K-AUTH-*）、SDK 接口
  （S-ERROR-*）。向后兼容路径硬切；legacy alias 禁。
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

Topic 已存在。还没有 wave。

## 阶段 2：设计（仍 `proposal`）

团队写一份 `design.md` 勾出迁移要长什么样。设计里点名：

- 新的 `SessionBearer` 合同。
- `JWT`（既有）跟 `SessionBearer`（新）之间的关系 —— 显式准入的双真相，附带计划好的 cutover 日期，不是 `legacy_alias` 那种偷偷留着。
- 这次迁移要满足的四闭合条件。

## 阶段 3：Wave-1 准入（`proposal → ongoing`）

团队准入第一个 wave。

```yaml
- wave_id: wave-1-auth-spec-update
  slug: auth-spec-update
  state: admitted
  primary_closure_goal: |
    更新 `.nimi/spec/runtime/kernel/auth-service.md` 与
    `.nimi/spec/sdk/kernel/error-projection.md`，准入
    SessionBearer 合同跟 JWT 并存。显式双准入，附带 cutover
    日期。
  deps: []
  owner_domain: .nimi/spec/runtime/kernel/auth-service.md 与 .nimi/spec/sdk/kernel/error-projection.md
  parallelizable_after: stable_authority_contract
  selected: true
```

Topic 状态推进：`proposal → ongoing`。`selected_next_target` 指向 wave-1。

## 阶段 4：实现前权威收敛

Wave-1 是 `spec` 类 packet（碰到了 `.nimi/spec/`）。权威收敛门启动。

Manager 跑一次独立审计（另一段 AI session）：

| Result kind | audit |
| Verdict | PASS |
| Findings | 无 blocking |

Manager 把审计结果记下来。Wave-1 现在可以 dispatch。

## 阶段 5：Wave-1 packet 冻结、worker 派出

Packet 被冻结，写明 allowed reads、allowed writes、acceptance invariant、negative test、stop line、reopen 条件。

Worker（AI 宿主）在 packet 边界内执行：

- 读 `.nimi/spec/runtime/kernel/auth-service.md`。
- 编辑该文件，准入 `SessionBearer` 合同。
- 读 `.nimi/spec/sdk/kernel/error-projection.md`。
- 编辑添加 SessionBearer 错误原因码。
- 在 packet 边界处停下，不碰别的表面。

## 阶段 6：实现后判断

独立循环 review 这次实现。

| Result kind | judgement |
| Verdict | PASS |
| Findings | 无 blocking |

Wave-1 可以走向 closeout。

## 阶段 7：Wave-1 Closeout（四个闭合）

| 维度 | 裁定 | 证据 |
| --- | --- | --- |
| 权威闭合 | closed | 规范化拥有者唯一；没引入并行真相 |
| 语义闭合 | closed | SessionBearer 必填字段、失败模式都钉住 |
| 消费方闭合 | closed | App 开发者能读 SessionBearer 合同；runtime 与 SDK 对齐 |
| 抗漂移闭合 | closed | 禁用捷径（`legacy_alias`、`compat_shim`、`dual_read`、`dual_write`）显式声明；reopen 条件显式 |

Wave-1 闭合。Topic 留 `ongoing`，因为还有别的 wave。

## 阶段 8：Wave-2 准入（runtime 实现）

Wave-2 按新 spec 实现 runtime auth-service 的改动。

```yaml
- wave_id: wave-2-runtime-auth-implementation
  slug: runtime-auth-implementation
  state: admitted
  primary_closure_goal: |
    在 runtime auth-service 里实现 SessionBearer 的发放与
    校验。JWT 路径在 wave-1 的显式双真相准入下继续可用。
  deps:
    - wave-1-auth-spec-update
  owner_domain: runtime/internal/auth/**
```

Wave-2 是 `implementation` 类 packet（不碰 `.nimi/spec/`）；权威收敛门不启动。Wave-2 可以直接 dispatch。

## 阶段 9：Wave-2 遭遇 OVERFLOW

实现到一半，worker 碰到 packet 边界，工作还没完。工作没跨进新的 owner 域，方向还是对的，没引入影子真相。

| Result | OVERFLOW |
| Reason | Packet 边界划得太窄 |

Manager 评估：continuation 可不可以准入？可以（方向对、范围没出去、无影子真相、不需要 fallback）。

Manager 准入一份延展边界的 continuation packet。Worker 重启执行。

## 阶段 10：Wave-2 Closeout

Continuation 完成之后，wave-2 走过四闭合（PASS）闭合。

## 阶段 11：Wave-3（SDK 接口）

Wave-3 更新 SDK，把新的 SessionBearer 错误原因码暴出来。

派单、审计、closeout 之后 —— 闭合 PASS。

## 阶段 12：Topic 进入 Pending

所有准入的 wave 都闭了。这次迁移在机械上完成。但是：团队希望改动上线之后在生产环境观察一个完整周期，然后再宣布 true close。

Topic 状态推进：`ongoing → pending`，附带显式 `pending-note`：

```yaml
reason: awaiting-deployment-observation
close_trigger: 一个完整发布周期内未发现 SessionBearer 回归
reopen_criteria: 出现 SessionBearer 回归；在本 topic 下准入
  remediation wave
```

## 阶段 13：Pending 解除；True Close

一个发布周期之后没有回归。团队启动 true close。

| 步骤 | 动作 |
| --- | --- |
| 1. Topic-true-close-audit | 独立审计核验四闭合在生产观察下都成立 |
| 2. result-topic-true-close | 已记录 |
| 3. topic.yaml 更新 | `state: pending → closed`；`current_true_close_status: not_started → true_closed`；`last_transition_reason: topic_true_close_passed` |
| 4. 文件夹搬动 | `.nimi/topics/pending/2026-06-15-auth-jwt-plus-session-migration/` → `.nimi/topics/closed/2026-06-15-auth-jwt-plus-session-migration/` |

## 这次走查体现了什么

| 性质 | 在走查里怎么出现 |
| --- | --- |
| 权威被点名 | Topic 携带 `forbidden_shortcuts`、owner_domain、parallel_truth posture |
| 执行被 packet 化 | 每个 wave 各有自己的 packet，写明 allowed_reads / writes |
| 闭合是多维的 | Wave-1 closeout 显式覆盖四个维度 |
| 角色分离 | Manager 准入、worker 执行、独立 auditor review |
| 权威收敛 | Spec wave 要求实现前审计 + 实现后判断 |
| 禁用捷径 | 在 packet 层声明；审计时核对 |
| Overflow 与 PASS | Wave-2 触发 overflow；显式条件下准入 continuation |
| True close ≠ 文件夹闭合 | Wave 闭合之后 topic 还在 pending；true close 要单独审计 |
| Pending 状态 | 用于「等生产观察」，附类型化 reopen 标准 |

每一项都对应包准入的实际机制。

## 这次走查没展示什么

| 关注 | 不展示的理由 |
| --- | --- |
| 实际的 auth 代码 | 在文档范围之外 |
| 用了哪个具体 provider / model | 宿主无关；对方法论不重要 |
| CI 管道细节 | 那是 DevOps 层，不是 Nimi Coding 层 |
| 行级 diff | 这里讲的是 wave 级纪律，不是行级 |

## 来源

- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic.schema.yaml)
- [`.nimi/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/wave.schema.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/closeout.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/closeout.schema.yaml)
