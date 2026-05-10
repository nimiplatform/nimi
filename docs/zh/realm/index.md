# Realm

Realm 是世界真相的权威归属域。一个世界的持久语义都由 Realm 管理，涵盖真相、当前状态、状态演进的历史轨迹、聊天语义，以及社交、经济、资产、绑定关系、资源和跨世界迁移（Transit）等子域。

在架构分层中，Runtime 负责处理 AI 任务的执行，SDK 为应用提供安全的访问边界，桌面端与网页端负责呈现用户体验。一个世界所共享的核心真相则锚定于 Realm 之上，平台上其他各层最终均需指向此域。

## 本节包含的内容

世界语义：

- [真相](/zh/realm/truth)：与写入时机无关、构成世界基底的客观事实。
- [世界状态](/zh/realm/world-state)：当前时间点世界所展现的状态。
- [世界历史](/zh/realm/world-history)：记录世界如何演变至当前状态的仅追加（append-only）轨迹。
- [呈现](/zh/realm/projection)：Realm 的数据结构向应用层读者提供数据访问的规则。

Realm 子域：

- [聊天](/zh/realm/chat)：当对话文本承载了世界的实质含义时，对于会话线程（Thread）、消息、成员资格以及 Agent 槽位（Slot）的生命周期管理。
- [社交与经济](/zh/realm/social-and-economy)：由 Realm 权威管理的关系图谱与价值流转、兑换契约。
- [资产与绑定](/zh/realm/asset-and-binding)：世界内包含的内容，及其与参与者、场景之间的附着关系。
- [Transit](/zh/realm/transit)：基于 OASIS 架构的单跳连续性协议，支持参与者跨越不同世界。

创作者与应用表面：

- [创作者经济](/zh/realm/creator-economy)：围绕世界创作者的经济体系、收益模型与结算机制。
- [应用互联](/zh/realm/app-interconnect)：规范应用层消费 Realm 核心真相的准入模式。

关于真相、状态、历史的高层定义与区分，详见 [平台 → 世界 → 真相、状态与历史](/zh/platform/worlds/state-vs-history)。遇到不熟悉的专业词汇，可查阅跨领域通用的[术语表](/zh/reference/glossary)。

## 为什么需要 Realm

在一个开放世界中，仅靠模型生成的文本响应并不充分。世界需要稳定且一致的状态与历史支撑。当世界发生变迁、关系产生演化，或是参与者执行特定动作时，平台必须拥有一个集中且权威的域，将这些事件以一致的逻辑记录并表达。

Realm 即是承担这一职责的语义底座。同时，它的存在也为跨世界契约提供了实际意义：各项基础协议需要一个明确的锚点来维持一致性，Realm 便是这一锚点。

## 场景演示：对话改变世界真相

假设两名参与者在世界中进行了一段对话，并且依据该世界的特定规则，他们之间建立了一条新的社交关系。在 Realm 契约体系下，此过程运转如下：

1. 促成该新关系的对话语义，将受到 `R-CHAT-*` 系列规则的管辖。
2. 新生成的社交关系本身，将登记在社交契约 `R-SOC-*` 的范畴内。
3. 世界的当前状态将依据 `R-WSTATE-*` 契约规范进行同步更新。
4. “建立新关系”这一事件将作为历史事实，记录于世界历史契约 `R-WHIST-*` 之中。

此流程中，每一个步骤都严格遵循已准入的 Realm 契约执行。任何应用或 Mod 均无权在 Realm 权威之外私自声明某条关系的存续，也无法强制其他平台层接受此类声明。

## 场景演示：读取世界历史

当用户需要了解当前世界是如何演变至今时，Realm 提供了一条标准的公共数据读取路径：

1. 世界的当前状态直接从世界状态契约中读取。
2. 导致这一状态的历史演变轨迹，从世界历史契约中提取。
3. 这两次读取操作返回的数据结构，均可直接交由 SDK 进行渲染呈现，具体细节参阅 [SDK Realm 与世界客户端](/zh/sdk/realm-world-client)。

核心要义在于：历史是平台中的一等概念，而非单纯的派生系统日志。一个世界中发生的事件，是构成其核心真相的实质部分，绝非事后补充的附属数据。

## 来源依据

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/index.md)
- [`.nimi/spec/realm/kernel/truth-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/truth-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/chat-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/chat-contract.md)
- [`.nimi/spec/realm/kernel/social-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/social-contract.md)
- [`.nimi/spec/realm/kernel/economy-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/economy-contract.md)
- [`.nimi/spec/realm/kernel/asset-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/asset-contract.md)
- [`.nimi/spec/realm/kernel/transit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/transit-contract.md)
