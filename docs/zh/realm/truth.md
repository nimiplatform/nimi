# Realm 权威状态与职责边界

在 Nimi 的系统架构中，跨越不同数字世界的共享核心事实——包括全局账号身份、社交与好友关系图谱、`WorldCore` 元数据、角色设定以及世界生命周期规则——均由服务端的 Realm 作为**单一权威可信源（Single Source of Truth）**统一治理。

Desktop、Web 与各类应用不会在本地私自定义或覆写这些全局状态，而是通过 `@nimiplatform/sdk` 提供的类型安全客户端消费 Realm 的状态投影；受保护应用访问 Realm 所需的凭据与代理通道则由 Runtime 统一掌管。

## 平台组件职责划分

| 平台组件 | 核心职责 |
| --- | --- |
| **Realm** | 持有服务端权威与持久化真相，管理全局账号、社交图谱、`WorldCore` 与角色设定等核心实体 |
| **SDK（`@nimiplatform/sdk`）** | 基于 Realm OpenAPI 规范生成的类型化客户端（Typed Client），提供数据 Schema、重试策略与结构化错误，自身不持有 Realm 服务权威 |
| **Runtime** | 受保护消费的凭据与代理通道中介（非 UI 界面），负责保管受保护 App 访问所需的凭据并转发受控请求 |
| **Desktop / Web / App** | 状态消费与交互表面，展示并使用来自 Realm 的状态投影，不可绕过资源所有者（Owner）私自变更全局状态 |

## 核心不变量与当前实现边界

- **权威唯一性**：全局身份、好友关系、`WorldCore` 与角色设定由 Realm 集中维护，客户端与单个世界不各自维护相互冲突的私有账本。
- **所有者权限边界**：共享接口与标准协议不会授权任何 App 越过资源所有者（Owner）直接修改受保护的实体或关系状态。
- **规划契约与现行能力边界**：
  - `WorldState` 与 `WorldHistory` 目前仍属于规划中的协议契约，并非当前 Home 中已可执行完整世界状态流转的实时账本。
  - 创作者经济中的“收益分成预览”仅用于配置预览，不等于真实资金结算，创作者提现能力尚未接通。
- **故障封闭语义（Fail-Closed）**：若与 Realm 通信中断或出现 Schema 不匹配，系统会直接返回明确的不可用状态，杜绝在本地伪造操作成功。

应用开发者应统一通过 `@nimiplatform/sdk`（以及由 Runtime 代理的受保护通道）消费 Realm 服务，避免自行拼接裸 REST 端点或在本地构造伪造权威结果的模拟数据。

## 相关文档

- [世界权威状态与历史对比](/zh/platform/worlds/state-vs-history)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
