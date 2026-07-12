# 禁用反模式

Nimi Coding 为反复出现的治理失败提供稳定名称，让 Codex、评审者和确定性门禁
能够一致拒绝同一类问题。

| Key | 拒绝的行为 |
| --- | --- |
| `mvp_subset_contract` | 用临时最小子集替代完整产品真相 |
| `legacy_alias` | 通过 alias 保留过时语义 |
| `compat_shim` | 用兼容代码掩盖未完成的 owner 硬切 |
| `dual_read` | 保留两条未经准入的真相读取路径 |
| `dual_write` | 保留两条未经准入的真相写入路径 |
| `placeholder_success` | 必备真相或证据缺失时仍声称成功 |
| `happy_path_only_closure` | 只验证成功路径就完成任务 |
| `time_phased_layering` | 用交付阶段代替产品架构 |
| `app_local_shadow_truth` | 让应用局部便利状态成为隐藏权威 |
| `silent_owner_cut_reopen` | 在下游实现中重开 owner 真相 |

## 使用方式

当前 Codex 任务把目录作为项目约束读取。Preflight 指出相关风险，实现主动避开，
测试或 validators 让违规可观测。目录不决定宿主计划或下一步动作。

## 示例

应用因为 SDK 少一个方法，就新增局部 REST 调用。代码虽然工作，却形成
`app_local_shadow_truth` 和边界 bypass。正确做法是在 SDK owner 补公共表面，
再由应用消费。

## 来源依据

- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
- [`.nimi/contracts/negative-fixtures.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/negative-fixtures.yaml)
