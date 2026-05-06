# 怎么准入外部 host

你想为 Nimi-Coding 采纳项目用一个新 AI host。包是宿主无关的，但每个 host 要满足必需能力。

## 菜谱

1. **校验 host 能力 flag。**
   - `read_project_local_nimi_truth`
   - `route_declared_external_skills`
   - `fail_closed_on_missing_authority`
2. **校验硬约束。**
   - `vendor_neutral_profile_only`
   - `do_not_assume_local_runtime_install`
   - `do_not_claim_packet_orchestration_ownership`
3. **用通用外部 host profile** 如这个 host 没 admitted adapter overlay。
4. **或写一份 host adapter overlay** 在 `adapters/<host-name>/profile.yaml` 如要 host 特定路由且包准入。
5. **跑 `nimicoding doctor`** 校验 host 姿态。如 doctor 报 host 兼容，你能用它。
6. **经 `nimicoding handoff --skill <skill> --json` hand off** 在新 host 下。
7. **Closeout** 照常。

## 必需能力 — 详细

### `read_project_local_nimi_truth`

Host 必须能读 `.nimi/methodology/`、`.nimi/spec/`、`.nimi/contracts/` 等作为它上下文的一部分。无视项目本地真相、只靠自己训练数据的 host 这项检查不过。

### `route_declared_external_skills`

Host 必须接受包的类型化 handoff payload 并路由到合适技能。重新解释 payload 或替换自己技能集的 host 这项检查不过。

### `fail_closed_on_missing_authority`

Host **不**能在缺权威时合成输出。在缺 source basis 时幻觉貌似内容的 host 这项检查不过。

这是最独特的要求。多数 AI host 默认「总产出某种东西」。Nimi Coding 要求「权威缺时啥都不产出」。

## 硬约束 — 详细

### `vendor_neutral_profile_only`

Host adapter **不**能把厂商特定合同夹带回包。厂商特定行为住在 adapter overlay 里、**不**住在方法学核里。

### `do_not_assume_local_runtime_install`

Host **不**能要求包装本地 runtime。包姿态是 `runtime_installed: false`、`installation_mode: deferred`。

### `do_not_claim_packet_orchestration_ownership`

Host **不**能装作拥有 packet 生命周期。Manager 准入 packet；host（worker / auditor）在它里头动作。

## 用通用 profile

通用外部 host profile 住在 `config/host-profile.yaml`：

```yaml
host_profile:
  id: external_ai_host
  host_class: ai_native_coding_host
  ownership_mode: external
  execution_mode: delegated
  install_state: not_installed
  self_hosted: false
```

满足必需能力的任何 host 能在通用 profile 下被准入。基础用**不**要 adapter overlay。

## 写 adapter overlay

如要 host 特定路由或命名 overlay 元数据：

1. **建 `adapters/<host-name>/profile.yaml`。** 把 host 声明为受约束桥。
2. **引必需能力 flag。** 陈述 host 满足必需集。
3. **记录 host 特定路由细节。** 不让它们漏进方法学核。
4. **用 `nimicoding doctor` 测。** Doctor 校验 admitted overlay 兼容。

包附带一个示例 overlay 放在 `adapters/oh-my-codex/profile.yaml`。具体示例见 [附录 → oh-my-codex](/zh/nimicoding/appendix/oh-my-codex)。

## 阅读场景：准入新 host

你想用 Host X 做项目的 `high_risk_execution` 跑。

| 步骤 | 动作 |
| --- | --- |
| 校验能力 | Host X 读项目本地真相、路由类型化技能、缺权威 fail-close |
| 校验约束 | Host X 厂商中立兼容、不要本地 runtime、不要 packet 编排 |
| 用通用 profile | 是 — 第一次用不要 adapter overlay |
| `nimicoding doctor` | 报兼容 |
| Hand off | `nimicoding handoff --skill high_risk_execution --json` |
| 结果 | Host X 执行；包准入结果 |

如 host 没满足能力检查，**别**用它。包**不**静默降级。

## 阅读场景：移除 host

你想停用一个 host。

| 步骤 | 动作 |
| --- | --- |
| 停 dispatch 新工作给它 | 自解释 |
| 既有工件留 | 该 host 下过去工作是规范化的 |
| 移 adapter overlay 如有 | 删 `adapters/<host-name>/profile.yaml` |
| 既有 topic / wave 工件不变 | 它们是过去工作的记录、**不是**活跃配置 |

方法学的可移植性意味换 host 可逆、**不**要数据迁移。

## 要看什么

| 症状 | 含义 |
| --- | --- |
| Host 在缺权威时幻觉内容 | 能力 `fail_closed_on_missing_authority` 没满足；拒 |
| Host 想自动跑 packet | 约束 `do_not_claim_packet_orchestration_ownership` 没满足；拒 |
| Host 要本地 runtime 装 | 约束 `do_not_assume_local_runtime_install` 没满足；拒 |
| Adapter overlay 把厂商特定合同夹带进方法学 | 约束 `vendor_neutral_profile_only` 没满足；拒 |

## 来源

- [`nimi-coding/config/host-profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-profile.yaml)
- [`nimi-coding/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-adapter.yaml)
- [`nimi-coding/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/external-host-compatibility.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-runtime.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/adapters/oh-my-codex/profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/adapters/oh-my-codex/profile.yaml)（例子）
