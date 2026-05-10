# 兼容姿态

Nimi 公开文档对兼容性与迁移的姿态参考。

## 姿态摘要

| 属性 | 值 |
| --- | --- |
| 姿态名 | `no_legacy_hard_cut` |
| 处于发布前 | 是 |
| 软兼容 shim | 禁止 |
| 时间维度分层 | 禁止（分层只按本体：core / extended / custom） |
| 严格协议版本 | 是 |
| 契约违例 fail-close | 是 |
| retry 救契约失败 | 否 |

## 实际含义

| 情况 | 预期行为 |
| --- | --- |
| 某页被删除 | 优先于保留一份过期页面 |
| 强类型契约失败 | 上抛强类型错误，不静默回退 |
| 出现 retry | 仅用于传输 / auth refresh，不救契约 |
| 旧路径存在 | 要么按已准入公开真相保留，要么硬移除；不留作隐式兼容 |
| 新功能上线 | 一次性带完整契约设计，不通过 MVP 子集再补 |

## 禁止的兼容形态

方法论 `forbidden_shortcuts` 目录列出公开文档与实现拒绝的模式：

| 键 | 拒绝的模式 |
| --- | --- |
| `legacy_alias` | 用软别名延续过时语义 |
| `compat_shim` | 用临时兼容代码遮盖归属切割 |
| `dual_read` | 两条未显式准入的并行真相读路径 |
| `dual_write` | 两条未显式准入的并行真相写路径 |
| `mvp_subset_contract` | 把规范契约削减为临时最小子集 |
| `time_phased_layering` | 用时间切片（v1/v2/v3）替代语义分层 |
| `placeholder_success` | 在缺失真相时假装成功或闭合 |
| `happy_path_only_closure` | 仅完成 happy path 就宣告闭合 |
| `app_local_shadow_truth` | App 本地便利状态变成隐式规范真相 |
| `silent_owner_cut_reopen` | 在下游执行 wave 中重开归属域真相 |

## 发布前公开声明的约束

发布前，公开文档不发布以下内容：

| 声明类型 | 姿态 |
| --- | --- |
| 安装命令（curl / npm / pnpm / brew / apt / yarn） | 等分发证据准入后再开 |
| 下载链接 | 等分发证据准入后再开 |
| 发布状态 / 上线承诺 | 等发布证据准入后再开 |
| 具体 provider 名 / 模型名 | 等目录证据准入后再开 |
| Provider 可用性矩阵 | 等目录证据准入后再开 |
| 对未上线面声明 "Available now" / "GA" / "Stable" | 禁止 |

完整禁止列表与检测模式见 [禁止声明](/zh/reference/forbidden-claims)。

## 契约演进路径

一个已定义但未上线的面如何到达公开面：

1. 按对应权威域准入 kernel 契约（`P-PROTO-*` / `K-*` / `S-*` / `D-*` / `R-*`）。
2. 在归属域内完成实现。
3. provider / 模型的目录证据准入。
4. 分发 / 发布证据准入（用于 install / download）。
5. 公开文档页更新可用性。

文档页不能预告契约还没到达的阶段。

## 来源依据

- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/runtime/kernel/model-catalog-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/model-catalog-contract.md)
- [`.nimi/spec/runtime/kernel/provider-health-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/provider-health-contract.md)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
