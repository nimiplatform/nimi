# 兼容性姿态

Nimi 公开文档的兼容与迁移姿态参考。

## 姿态总结

| 性质 | 值 |
| --- | --- |
| 姿态名 | `no_legacy_hard_cut` |
| Pre-launch | 是 |
| 软兼容 shim | 禁 |
| 时间分层 | 禁（分层是本体性的：core / extended / custom） |
| Strict-only 协议版本 | 是 |
| 合同违反 fail-close | 是 |
| 重试救援合同失败 | 否 |

## 给读者的实操含义

| 情况 | 预期行为 |
| --- | --- |
| 某页被移除 | 优先于过时页 |
| 类型化合同失败 | 露类型化错误、**不**静默回退 |
| 重试发生 | 只为 transport / auth 刷新、**永不**救援合同 |
| 旧路由存在 | 要么作为 admitted 公开真相保留、要么硬移除；**不**作为隐藏兼容保留 |
| 新功能上线 | 带完整合同设计交付、**不**作为以后补全的 MVP 子集 |

## 禁用兼容形状

方法学的 `forbidden_shortcuts` 目录列公开文档与实现拒的模式：

| Key | 拒绝模式 |
| --- | --- |
| `legacy_alias` | 用软别名让旧语义存活 |
| `compat_shim` | 把 owner-cut gap 藏在临时兼容代码后 |
| `dual_read` | 没显式准入的两条并行真相读路径 |
| `dual_write` | 没显式准入的两条并行真相写路径 |
| `mvp_subset_contract` | 把规范化合同真相切成临时最小子集 |
| `time_phased_layering` | 用时间切片（v1/v2/v3）替代语义分层 |
| `placeholder_success` | 缺必需真相时伪造成功或闭合 |
| `happy_path_only_closure` | 只闭 happy path 就声称闭合 |
| `app_local_shadow_truth` | App 局部便利状态变成隐藏规范化真相 |
| `silent_owner_cut_reopen` | 在下游执行 wave 内重开 owner 域真相 |

## Pre-Launch 公开声明约束

公开文档当前不发布以下类别：

| 声明类 | 姿态 |
| --- | --- |
| 安装命令（curl / npm / pnpm / brew / apt / yarn） | 在 admitted 分发证据前扣下 |
| 下载链 | 在 admitted 分发证据前扣下 |
| 发布状态 / 发布承诺 | 在 admitted 发布证据前扣下 |
| 具体 Provider 名 / Model 名 | 在 admitted 目录证据前扣下 |
| Provider 可用性矩阵 | 在 admitted 目录证据前扣下 |
| Defined-but-not-shipped 面的「现在可用」/「GA」/「稳定」声明 | 禁 |

完整禁用公开文档声明列表带检测模式见 [禁用主张](/zh/reference/forbidden-claims)。

## 合同演化路径

defined-but-not-shipped 面怎么毕业到公开面：

1. 在合适的权威域下准入 kernel 合同（`P-PROTO-*` / `K-*` / `S-*` / `D-*` / `R-*`）。
2. 实现在 owner 域下落地。
3. 准入目录证据（给 Provider / Model）。
4. 准入分发 / 发布证据（给安装 / 下载）。
5. 公开文档页更新反映可用性。

文档页**无法**预宣告合同演化没到的阶段。

## 来源

- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/runtime/kernel/model-catalog-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/model-catalog-contract.md)
- [`.nimi/spec/runtime/kernel/provider-health-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/provider-health-contract.md)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
