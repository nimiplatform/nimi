# 全流程走查 (Walkthrough)

本页提供了一个合成的、从头到尾完整的 Nimi Coding Topic 案例——虽然它是我们为了演示整个流转过程而虚构的，但它完美复刻了真实的工程场景。

## 初始设定 (Setup)

一支开发团队正在着手将他们的认证服务从“仅支持 JWT”升级为“JWT + 会话凭证 (Session-bearer)”双轨模式。这项改动不仅触及权威合同（Authority contracts），还横跨了运行时执行逻辑（Runtime execution）以及客户端 SDK 投影。

这，正是这套方法论最擅长处理的“跨域高风险任务”的完美模版。

我们将全程跟踪这个 Topic，看它如何从 `proposal`（提案）一路杀到 `closed`（闭合）。

## 阶段 1：创建 Topic (`proposal`)

团队的首席工程师（Lead engineer）起草了这个 Topic。

`topic.yaml` (初始状态):

```yaml
topic_id: 2026-06-15-auth-jwt-plus-session-migration
state: proposal
created_at: 2026-06-15
last_transition_at: 2026-06-15
last_transition_reason: topic_created
title: Auth JWT-Plus-Session Migration
mode: landed
posture: no_legacy_hard_cut # 必须一刀切断旧路径
design_policy: complete_contract_first # 完整设计必须先行
parallel_truth: forbidden # 严禁双重真相
layering: ontology
risk: high
applicability: high_risk_refactor
entry_justification: |
  将认证从纯 JWT 迁移为 JWT+Session bearer 模式。
  横跨权威合同 (P-AUTH-*)、运行时执行 (K-AUTH-*)、SDK 投影 (S-ERROR-*)。
  向后兼容路径必须执行硬切换（Hard-cut）；严禁保留旧别名（Legacy alias）。
execution_mode: manager_worker_auditor # 采用最严格的三角色分离
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

此时，Topic 已经建档。但里面还没有任何 Wave。

## 阶段 2：系统设计 (仍在 `proposal` 阶段)

团队产出了一份 `design.md`，勾勒出了这次大迁徙的蓝图。这份设计清晰地界定了：

- 新的 `SessionBearer` 合同长什么样。
- 原有的 `JWT` 与新进的 `SessionBearer` 之间是什么关系——是一份敲定了硬切日期、并经过显式准入的双轨真相过渡期合同，绝不是靠着 `legacy_alias` 暗度陈仓。
- 此次迁移必须满足的四个闭合维度条件。

## 阶段 3：准入 Wave-1 (`proposal → ongoing`)

团队准入了第一个 Wave。

```yaml
- wave_id: wave-1-auth-spec-update
  slug: auth-spec-update
  state: admitted
  primary_closure_goal: |
    更新 `.nimi/spec/runtime/kernel/auth-service.md` 和
    `.nimi/spec/sdk/kernel/error-projection.md`，在 JWT 的基础上
    准入 SessionBearer 合同。显式宣告双重准入，并标明切除日期。
  deps: []
  owner_domain: .nimi/spec/runtime/kernel/auth-service.md 和 .nimi/spec/sdk/kernel/error-projection.md
  parallelizable_after: stable_authority_contract
  selected: true
```

Topic 的状态随之流转：`proposal → ongoing`。`selected_next_target` 的指针落在了 wave-1 上。

## 阶段 4：实现前的权威收敛 (Pre-Implementation Authority Convergence)

因为 Wave-1 是一个 `spec` 类型的 Packet（它触碰了 `.nimi/spec/`），**权威收敛关口**被强行触发。

Manager 唤醒了一次独立审计（在一个完全区隔开的 AI 会话中进行）：

| 结果类型 | audit (审计) |
| 裁定 | PASS |
| 发现项 | 无阻塞性问题 |

Manager 将这份 PASS 审计记录在案。至此，Wave-1 终于拿到了分派放行条。

## 阶段 5：冻结 Packet 并分派 Worker

Packet 被正式冻结，上面写死了允许查阅的范围、允许写入的边界、验收恒定式、反向测试、止损线，以及重开条件。

Worker（AI 宿主）被戴上镣铐，在 Packet 划定的结界内开始干活：

- 读取 `.nimi/spec/runtime/kernel/auth-service.md`。
- 修改文件，宣告准入 `SessionBearer` 合同。
- 读取 `.nimi/spec/sdk/kernel/error-projection.md`。
- 修改文件，追加 SessionBearer 的专属错误原因码。
- 抵达 Packet 的读写边界，立刻停手；绝对没有触碰项目里的其他代码。

## 阶段 6：落地后的判断 (Post-Implementation Judgement)

独立审查循环再次介入，对写下的代码进行复核。

| 结果类型 | judgement (判断) |
| 裁定 | PASS |
| 发现项 | 无阻塞性问题 |

双 PASS 到手，Wave-1 获准向收尾（Closeout）冲刺。

## 阶段 7：Wave-1 收尾 (四个闭合维度)

| 维度 | 裁定 | 证据 |
| --- | --- | --- |
| 权威闭合 | closed | 规范所有者唯一；未引入任何影子真相 |
| 语义闭合 | closed | SessionBearer 的必填项和失败模式已被钉死 |
| 消费方闭合 | closed | App 开发人员可以顺畅阅读 SessionBearer 合同；运行时与 SDK 语意对齐 |
| 抗漂移闭合 | closed | 禁用捷径 (`legacy_alias`, `compat_shim`, `dual_read`, `dual_write`) 已在反模式目录中声明；重开条件已明确 |

Wave-1 完美闭合。因为还有其他 Wave 正在路上，Topic 保持在 `ongoing` 状态。

## 阶段 8：准入 Wave-2 (运行时实现)

Wave-2 的使命，是把 Wave-1 改好的新 Spec 落入实际的运行时 auth-service 代码中。

```yaml
- wave_id: wave-2-runtime-auth-implementation
  slug: runtime-auth-implementation
  state: admitted
  primary_closure_goal: |
    在 runtime auth-service 中实现 SessionBearer 的签发和验证。
    遵循 wave-1 显式准入的双轨真相契约，保持 JWT 路径继续运行。
  deps:
    - wave-1-auth-spec-update
  owner_domain: runtime/internal/auth/**
```

由于 Wave-2 属于纯 `implementation` 类型的 Packet（完全不碰 `.nimi/spec/`），权威收敛关口不会拦截它。Wave-2 可以直接分派。

## 阶段 9：Wave-2 遭遇溢出 (Overflow)

代码敲到一半，Worker 碰到了 Packet 划定的天花板，但任务还没干完。这活儿并没有越界去踩别人的自留地；大方向也毫无偏差；更没去搞什么影子真相。

| 结果 | OVERFLOW (溢出) |
| 原因 | Packet 边界划得太窄了 |

Manager 接到反馈开始盘算：允许准入延续包（Continuation）吗？
允许。（方向没错、范围没越轨、没搞影子真相、也没逼着写 Fallback 救场）。

Manager 慷慨地甩出一个延续包，扩宽了边界。Worker 继续撸起袖子干活。

## 阶段 10：Wave-2 收尾

借着延续包的光，代码终于敲完。Wave-2 在四大闭合维度的审视下拿到了全票 PASS，正式闭合。

## 阶段 11：Wave-3 (SDK 投影)

Wave-3 负责更新 SDK，把刚才新增的 SessionBearer 错误代码透传给客户端。

在经历了毫无波澜的分派、审计和收尾流程后，Wave-3 拿到 PASS，顺利闭合。

## 阶段 12：Topic 进入挂起状态 (Pending)

至此，所有已准入的 Wave 全部闭合。在机械层面上，这次大迁徙已经做完了。但是：团队希望把这次重大改动扔到生产环境里，静静观察一个发布周期，然后再彻底宣告它盖棺定论（True close）。

Topic 状态发生流转：`ongoing → pending`，并在 `pending-note` 中显式挂牌：

```yaml
reason: awaiting-deployment-observation
close_trigger: 在生产环境观察一整个完整的发布周期，且未出现与 SessionBearer 相关的回归问题
reopen_criteria: 观察到 SessionBearer 回归故障；届时在此 Topic 下准入一个专门用于抢修的 Wave
```

## 阶段 13：挂起状态解除；真正闭合 (True Close)

一个发布周期平稳度过，0 回归。团队终于扣动了 True close 的扳机。

| 步骤 | 动作 |
| --- | --- |
| 1. Topic 终局审计 | 独立审计员进行最后排查，确认哪怕经历了生产环境的毒打，四个闭合维度依然稳如泰山。 |
| 2. result-topic-true-close | 生成最终的闭合证据档案。 |
| 3. 刷新 topic.yaml | `state: pending → closed`; `current_true_close_status: not_started → true_closed`; 状态流转理由被标记为 `topic_true_close_passed`。 |
| 4. 挪运文件夹 | 整个案宗从 `.nimi/topics/pending/2026-06-15-auth-jwt-plus-session-migration/` 被光荣移入 `.nimi/topics/closed/2026-06-15-auth-jwt-plus-session-migration/`。 |

## 案例背后的门道：它揭示了什么？

| 特性 | 在本案例中的体现 |
| --- | --- |
| 权威被具名化 | Topic 里明文写着 `forbidden_shortcuts`、归属域（Owner domain），并锁死了双轨真相的姿态。 |
| 执行被包袱化 | 每一个 Wave 都被封进了一个带有死板 `allowed_reads / writes` 权限表的 Packet 里。 |
| 多维度的闭合观 | Wave-1 结案时，接受了四个维度的拷问，少一个都不行。 |
| 铁腕的角色分离 | Manager 负责放行，Worker 负责干活，独立的 Auditor 负责找茬。 |
| 权威收敛 | Spec 类的 Wave 必须生扛“实现前审计”和“落地后判断”两道大门。 |
| 禁用捷径目录 | 在 Packet 里白纸黑字发过誓，在审计时拿着放大镜一条条对。 |
| 溢出机制 ≠ PASS | Wave-2 弹了溢出警报，没有强行算 PASS，而是在苛刻的条件下续了一命。 |
| True close 不等于挪文件夹 | 就算活全干完了，Topic 依然被挂起去等生产环境的结果，只有独立审计才能给它发 True close 牌照。 |
| 挂起状态 (Pending) | 它被专门用来应对“等生产环境出结果”这种带有限定触发条件的等待期。 |

上面的每一条，都精准对应着这个包里雷打不动的底层契约。

## 案例刻意忽略了什么？

| 关注点 | 为什么不提？ |
| --- | --- |
| 具体的 Auth 代码怎么写 | 抱歉，那超出了治理文档的管辖范畴。 |
| 到底用了哪家的 AI 模型 | 宿主无关（Host-agnostic）；用哪家对于这套方法论来说毫无区别。 |
| CI/CD 流水线怎么配 | 那是 DevOps 该操心的活儿，不在 Nimi Coding 的治理边界内。 |
| 细枝末节的每行代码 diff | 本方法论抓的是 Wave 级别的纪律，不是为了搞单行代码评审。 |

## 来源依据

- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic.schema.yaml)
- [`.nimi/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/wave.schema.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/closeout.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/closeout.schema.yaml)