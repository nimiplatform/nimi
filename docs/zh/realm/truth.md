# Realm 权威状态与职责边界

在 Nimi 的分布式架构中，跨越所有数字世界的共享权威数据——包括全局账号身份、社交关系图谱、创作者经济、数字资产权属以及世界生命周期规则——均由服务端的 Realm 统一作为**单一可信源（Single Source of Truth）**进行治理与仲裁。

本地应用与桌面端不直接定义或覆写这些全局规则，而是通过 SDK 提供的类型安全客户端与标准化通道，安全消费与响应 Realm 广播的权威状态。

## Nimi 客户端与工具链的职责划分

| 平台模块 | 核心职责 |
| --- | --- |
| **SDK Realm 客户端核心** | 根据 Realm OpenAPI 规范自动生成类型安全的数据访问接口与序列化模型 |
| **SDK 门面（Realm Facade）** | 负责本地会话凭据注入、断线重试、安全错误映射与网络传输调度 |
| **Runtime / Desktop / Web** | 作为消费端，安全呈现从 Realm 读取的状态投影（Projections） |

## 明确的边界与不变量

- **权威唯一性**：跨世界的社交网络、好友关系、资产转移与创作者分成规则由 Realm 统一执行，本地客户端不维护脱离服务端的私有仲裁逻辑；
- **身份真实性**：全网唯一的用户公钥凭证与跨世界通行身份由 Realm 统一签发；
- **防伪造与强一致性**：若应用无法连接 Realm 或数据解析异常，系统将直接向用户提示明确的“服务不可用”状态，杜绝任何本地伪造“成功”的假象。

应用开发者如需与 Realm 交互，请统一使用 `@nimiplatform/sdk` 提供的标准接口，避免手动拼接底层 HTTP 端点或伪造本地模型。

## 相关文档

- [世界权威状态与历史对比](/zh/platform/worlds/state-vs-history)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
