# 准入一个外部宿主

你想在已经接入 Nimi Coding 的项目里换一个新的 AI 宿主。包本身宿主无关，但每个宿主都需要满足一组必备能力。

## 步骤

1. **核对宿主的能力标记。**
   - `read_project_local_nimi_truth`
   - `route_declared_external_skills`
   - `fail_closed_on_missing_authority`
2. **核对硬性约束。**
   - `vendor_neutral_profile_only`
   - `do_not_assume_local_runtime_install`
   - `do_not_claim_packet_orchestration_ownership`
3. **如果该宿主没有已准入的 adapter overlay**，使用通用外部宿主 profile。
4. **如果需要宿主特有的路由策略**，且包允许此种扩展，写一份 `adapters/<host-name>/profile.yaml` 的 adapter overlay。
5. **跑 `nimicoding doctor`** 验证宿主姿态。doctor 报告兼容即可使用。
6. **用 `nimicoding handoff --skill <skill> --json`** 在新宿主下完成交接。
7. **照常 closeout。**

## 必备能力详解

### `read_project_local_nimi_truth`

宿主必须能把 `.nimi/methodology/`、`.nimi/spec/`、`.nimi/contracts/` 等读入上下文。只依赖自身训练数据、忽略项目本地权威的宿主，不通过这一项检查。

### `route_declared_external_skills`

宿主必须接受包发出的强类型交接 payload，并路由到对应技能。重新解释 payload 或替换成自有技能集的宿主，不通过这一项检查。

### `fail_closed_on_missing_authority`

当所需权威缺失时，宿主不得自行合成输出。Source basis 缺失却仍然产出貌似合理内容的宿主，不通过这一项检查。

这是最有辨识度的一条要求。多数 AI 宿主默认行为是"总要给点输出"。Nimi Coding 要求"权威缺失就什么也别给"。

## 硬性约束详解

### `vendor_neutral_profile_only`

Adapter 不得把厂商特有契约偷渡回包里。厂商特有行为只能留在 adapter overlay，不能进入方法学核心。

### `do_not_assume_local_runtime_install`

宿主不得要求包安装本地 runtime。包的姿态是 `runtime_installed: false`、`installation_mode: deferred`。

### `do_not_claim_packet_orchestration_ownership`

宿主不得自称拥有 packet 生命周期的所有权。Packet 由管理者准入，宿主（worker 或 auditor）只在 packet 内部行动。

## 使用通用 profile

通用外部宿主 profile 位于 `config/host-profile.yaml`：

```yaml
host_profile:
  id: external_ai_host
  host_class: ai_native_coding_host
  ownership_mode: external
  execution_mode: delegated
  install_state: not_installed
  self_hosted: false
```

任何满足必备能力的宿主，都可以在这一通用 profile 下完成准入。基本使用不需要 adapter overlay。

## 写一个 adapter overlay

如果需要宿主特有的路由或命名 overlay 元数据：

1. **新建 `adapters/<host-name>/profile.yaml`。** 把宿主声明为受约束的桥接器。
2. **引用必备能力标记。** 声明该宿主满足必备能力集。
3. **记录宿主特有的路由细节**，且不允许这些细节渗入方法学核心。
4. **用 `nimicoding doctor` 检验。** doctor 会校验已准入 overlay 的兼容性。

包内附带一份示例 overlay：`adapters/oh-my-codex/profile.yaml`。具体示例见 [Appendix → oh-my-codex](/zh/nimicoding/appendix/oh-my-codex)。

## 场景：准入一个新宿主

你想用宿主 X 来跑项目的 `high_risk_execution`。

| 步骤 | 操作 |
| --- | --- |
| 核对能力 | 宿主 X 能读项目本地权威，能路由强类型技能，权威缺失时 fail-closed |
| 核对约束 | 宿主 X 厂商中立，不要求本地 runtime，不自称拥有 packet 编排权 |
| 使用通用 profile | 是；首次使用无需 adapter overlay |
| `nimicoding doctor` | 报告兼容 |
| 交接 | `nimicoding handoff --skill high_risk_execution --json` |
| 结果 | 宿主 X 执行；包准入结果 |

如果宿主未通过能力检查，不要使用。包不会以默契退化的方式硬上。

## 场景：移除一个宿主

你不再使用某个宿主。

| 步骤 | 操作 |
| --- | --- |
| 不再向它派发新工作 | 直接停止派发 |
| 既有工件保留 | 过往在该宿主下完成的工作仍是权威记录 |
| 删除 adapter overlay（如有） | 删除 `adapters/<host-name>/profile.yaml` |
| 既有 topic / wave 工件不变 | 这些是历史工作的记录，不是当前配置 |

方法学的可移植性意味着切换宿主是可逆的，不需要数据迁移。

## 注意事项

| 现象 | 含义 |
| --- | --- |
| 权威缺失时宿主仍输出内容 | `fail_closed_on_missing_authority` 未满足；拒绝 |
| 宿主想自主跑 packet | `do_not_claim_packet_orchestration_ownership` 未满足；拒绝 |
| 宿主要求安装本地 runtime | `do_not_assume_local_runtime_install` 未满足；拒绝 |
| Adapter overlay 把厂商契约偷渡进方法学 | `vendor_neutral_profile_only` 未满足；拒绝 |

## 来源依据

- [`nimi-coding/config/host-profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-profile.yaml)
- [`nimi-coding/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-adapter.yaml)
- [`nimi-coding/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/external-host-compatibility.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-runtime.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/adapters/oh-my-codex/profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/adapters/oh-my-codex/profile.yaml)（示例）
