# 数字世界（Worlds）架构概览

数字世界（`World`）是 Nimi 平台承载世界观设定、角色与故事演进的核心领域对象。

## 什么是数字世界

在 Nimi 中，数字世界由核心设定（`WorldCore`）、世界角色（`WorldCharacter`）、实体（`WorldEntity`）与关系（`WorldRelationship`）共同构成。它为交互提供持久的背景设定与人物谱系，使对话和叙事不再局限于一次性的孤立会话。

参与互动的用户与 AI 智能体并不被单一应用锁定：用户账号与人设角色（`PersonaCharacter`）在平台内保持一致身份，而智能体的长期记忆由 Cognition 按每个 `LocalAgent` 独立管理，并经由 Runtime 安全调用。

数字世界**不是**：
- **单纯的聊天室**：对话只是交互方式之一，世界为对话提供背景设定、角色关系与叙事语境。
- **一次性临时会话**：单次游玩或剧情会话结束后，世界的核心设定与角色资料依然持久保存在 Realm 中。
- **固定脚本关卡**：关卡只服务于单一流程，而世界提供可跨会话复用的设定、角色、实体与关系数据。
- **独立应用本身**：应用负责界面呈现与交互体验，数字世界则是存储在 Realm 中的权威领域记录。

## 数字世界的架构分层

Realm 将当前已开放的世界设定读写能力，与规划中的共享状态（World State）及演进历史（World History）契约清晰分离。后两者的模型设计请参阅 [世界状态与历史变迁](/zh/platform/worlds/state-vs-history)。

| 架构层级 | 核心职责 | 当前状态 |
| --- | --- | --- |
| **世界设定与角色档案** | 通过 `WorldCore`、`WorldCharacter`、`PersonaCharacter`、`WorldEntity` 与 `WorldRelationship` 维护世界设定、角色、实体与关系 | **当前接口**（通过 Runtime 准入的宿主绑定调用） |
| **世界即时状态（World State）** | 跨会话的持久共享状态（含 `WORLD` / `ENTITY` / `RELATION` 作用域），不包含应用运行变量、提示词上下文或渲染临时状态 | **规划中契约**（仅作设计参考，当前无获准的 controller 或 tracked OpenAPI 读写接口） |
| **世界演进历史（World History）** | 仅记录已接纳发生事实的追加日志；订正通过追加替代或无效化记录完成，而非静默硬删除 | **规划中契约**（仅作设计参考，当前无获准的 controller 或 tracked OpenAPI 读写接口） |

明确区分这三层边界，可以避免将当前可用的设定管理、应用私有的运行态数据与规划中的公共历史混为一谈。

## 相邻的平台服务与访问边界

围绕数字世界，Runtime 与 Realm 协同提供以下能力与安全边界：

| 能力模块 | 架构职责与边界 |
| --- | --- |
| **私聊与在线状态（DirectChat & Presence）** | Runtime 已准入的实时通道仅限人与人之间的 `DirectChat`、输入状态（`typing`）、收件箱（`inbox`）与在线状态（`Presence`） |
| **本地智能体与长期记忆** | `LocalAgent` 对话由 Runtime 承载，每智能体的长期记忆由 Cognition 管理并经 Runtime 中介调用 |
| **社交与经济体系** | 平台级社交关系、权限校验与资产结算由 Realm 统一治理 |
| **系统主世界与空间漫游（OASIS & Transit）** | `OASIS` 作为系统主世界提供正式的设定与角色接口；跨世界漫游协议的详细设计见 [系统主世界 OASIS](/zh/platform/worlds/oasis) |

普通应用访问 Realm 必须同时具备当前受保护宿主会话、清单 `realm.data` 声明以及 Runtime 准入，并由 Realm 校验具体的资源授权。Runtime 统一保管 Realm 凭据与远端实时连接，应用不直接持有 Bearer 令牌、原生 HTTP 或底层 socket；通知流（`Notification`）与通用世界事件广播均未对应用开放。

## 专题索引

- [世界状态与历史变迁](/zh/platform/worlds/state-vs-history) —— 规划中的 `WorldState` 与 `WorldHistory` 契约、提交信封与 `effectClass` 设计参考。
- [系统主世界 OASIS](/zh/platform/worlds/oasis) —— 系统主世界 `OASIS` 与跨世界漫游协议设计。
- [世界生命周期管理](/zh/platform/worlds/lifecycle) —— 世界创建资格、`WorldCore` 与 `WorldCharacter` 独立维护、`baseContentHash` 乐观并发更新与可见性设置。

字段层面的规范定义请参阅 [参考手册 → 数字世界核心字段](/zh/reference/world-fields)。

## 业务场景：在应用中访问数字世界

当用户在受保护的宿主会话中打开应用并加载某个数字世界时：

- **宿主鉴权与人设读取**：应用通过宿主绑定的 `client.realm.worldCore` 与 `client.realm.personaCharacter` 发起受控调用，无需自行管理平台凭据。
- **设定与关系查询**：应用可按权限读取该世界的 `WorldCore`、`WorldCharacter`、`WorldEntity` 与 `WorldRelationship` 数据，呈现世界观与人物关系。
- **智能体对话与私有记忆**：用户与 `LocalAgent` 的对话归 Runtime 处理，智能体长期记忆由 Cognition 按 Agent 独立存储并经 Runtime 调用；应用内的本地状态或私有故事记录不会自动同步为公开的世界状态或世界历史。
- **访问 OASIS 主世界**：应用可通过当前正式接口读取系统主世界 `OASIS` 的 `WorldCore` 与角色资料；关于跨世界漫游协议的设计细节，请参阅 [系统主世界 OASIS](/zh/platform/worlds/oasis)。

## 业务场景：创建与维护数字世界

有了世界创建资格，创作者可以先保存世界设定，再逐步补充角色与实体。已有内容通过各自的更新接口维护；发生并发修改时，先读取最新版本再决定如何合并。

世界创建资格由 Realm 管理员授予，保存记录也不等于发布到目录。具体操作与版本条件见[世界生命周期管理](/zh/platform/worlds/lifecycle)，字段说明见[数字世界核心字段](/zh/reference/world-fields)。

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
