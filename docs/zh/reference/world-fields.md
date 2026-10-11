# 数字世界核心字段与规范（World Fields）

本文档提供 Nimi 数字世界（World）在字段层级与契约层级的核心数据结构参考。

## 数字世界的核心属性定义

| 属性定义 | 规范说明 |
| --- | --- |
| **世界唯一标识（worldId）** | 全网唯一、不可篡改的字符串标识，具备时间排序特征 |
| **创作者归属（creatorId）** | 创建该世界的用户或团队账户 ID，拥有该世界的规则管理与收益权 |
| **持久性特征** | 世界的状态与历史独立于具体用户的在线状态，跨越会话边界持续存在 |
| **多协议互联** | 原生支持平台六大基础协议（Timeflow, Social, Economy, Transit, Context, Presence） |
| **单一可信源** | 规范的世界规则、世界当前状态与历史日志统一由 Realm 持久化存储 |

## 世界架构的三大核心数据支柱

| 核心支柱 | 字段含义 | 对应数据契约 |
| --- | --- | --- |
| **权威设定（Truth）** | 该世界的权威设定、基础规则与核心实体（可通过授权的 CorePatch 或 WorldRelease 版本演进） | Realm 规则字典（`R-TRUTH-*`） |
| **当前状态（World State）** | 世界在当前时刻的实体、属性与空间快照 | Realm 状态树（`R-WSTATE-*`） |
| **历史账本（World History）** | 世界从诞生至今经历的仅追加事件流 | Realm 历史日志（`R-WHIST-*`） |

## OASIS 系统主世界规范

- **枢纽定位**：OASIS 是全网唯一官方主世界，作为所有数字世界之间的通用中转枢纽；
- **平台公有**：不属于任何单一商业创作者，由平台公有治理；
- **默认安全归位点**：在跨世界漫游遇阻或目标世界离线时，作为参与者的默认安全避风港。

## 应用与世界连接关系（App-World Binding）

| 绑定状态 | 业务含义 |
| --- | --- |
| `(new)` | 世界已建立，尚未绑定任何活跃的应用控制器 |
| `active` | 某个 Extension App 已成功绑定并拥有世界状态的写入权限 |
| `suspended` | 绑定关系临时挂起，暂不允许写入新状态 |
| `revoked` | 绑定关系已解除，世界重新开放供其他应用申请绑定 |

> **单活跃写入者约束**：为了保证世界演进的时序一致性，同一世界在同一时刻仅允许绑定至多一个活跃的 `extension-app`。多个纯展示类的 `render-app` 则不受数量限制。

## 相关文档

- [世界状态机制详解](/zh/realm/world-state)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
