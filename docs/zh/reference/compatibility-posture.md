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
| 新功能上线 | 一次性带完整契约设计，不通过临时子集再补 |

## 禁止的兼容形态

仓库权威拒绝三类通用形态：hard cut 后继续保留已取代的产品语义、创建未经准入的
并行真相，以及在已准入契约无法兑现时返回伪成功。各 owner domain 可以在自己的
契约中增加更窄的禁止项；Nimi Coding 不再维护独立的反模式目录。

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
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/platform/kernel/release-gate-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/release-gate-contract.md)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/runtime/kernel/model-catalog-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/model-catalog-contract.md)
- [`.nimi/spec/runtime/kernel/provider-health-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/provider-health-contract.md)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
