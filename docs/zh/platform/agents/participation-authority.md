# 参与权威

## 状态：已准入，正在构建中 (Admitted, in build-out)

参与权威模型已在内核层获得准入
(`runtime-agent-participation-contract.md`, K-AGCORE-061..K-AGCORE-073)。
规范的智能体聊天（Agent Chat）配置文件目前正在运行；非规范配置文件（Realm 群组、场景沙盒、OASIS 世界参与者、外部 A2A、调试）已作为权威切面获得准入，其表面功能正在积极构建中。

## “参与权威”的含义

Nimi 智能体并非总是在执行同一种任务。有时它与您进行规范的智能体聊天。有时它与人类一起在 Realm 群组线程中。有时它在场景沙盒或 OASIS 世界中活动。有时它与外部 A2A 对应方进行通信。每一种情况都是一个**不同的参与上下文**，它们在记录所有权、身份、内存访问、能力范围、输入信任、输出目的地以及提升为持久智能体真相方面都有不同的规则。

参与权威模型是已准入的规则集合，它统一覆盖了所有这些上下文。它不是应用程序从中选择的选项列表，而是运行时强制执行的**封闭权威界面**。

## 九个正交维度

参与配置文件是九个已准入维度上值的固定组合。维度注册表是封闭的
(`tables/agent-participation-axis-model.yaml`)；应用程序不能提交开放字符串值。

| 维度 | 识别内容 | 示例值 |
| --- | --- | --- |
| `transcript_owner` | 记录所有者 / 事件日志真相所有者 | `RUNTIME`, `REALM`, `SCENARIO_MODULE`, `OASIS_WORLD_DOMAIN`, `EXTERNAL_DOMAIN`, `EPHEMERAL` |
| `identity_source` | 身份来源 / 参与者身份的所有者和含义 | `USER_OWNED_NIMI_AGENT`, `EXTERNAL_A2A_AGENT`, `MCP_BACKED_AI_CAPABILITY`, `SANDBOX_PROJECTION`, `NPC_WORLD_ACTOR` |
| `execution_owner` | 执行所有者 / 谁组装提示并调用 AI | `RUNTIME`, `EXTERNAL_RUNTIME_VIA_ADMITTED_GATEWAY`, `NOT_ADMITTED` |
| `memory_read_scope` | 内存读取范围 / 哪些内存可以加载到执行中 | `CANONICAL_OWNER_POLICY`, `DYADIC_PRIVATE_ALLOWED`, `DYADIC_PRIVATE_EXCLUDED`, `PUBLIC_SHARED_ONLY`, `DOMAIN_SHARED_ONLY`, `NO_MEMORY_READ` |
| `memory_write_default` | 内存写入默认设置 / 输出是否可以写入持久智能体真相 | `CANONICAL_WRITE_ALLOWED`, `WRITE_NONE`, `PROMOTION_GATED` |
| `capability_scope` | 能力范围 / 哪些工具/文件/委托能力获得准入 | `CANONICAL_AGENT_SCOPE`, `PROFILE_LIMITED`, `DOMAIN_LIMITED`, `DIAGNOSTIC_READ_ONLY`, `EXTERNAL_GATEWAY_LIMITED`, `NONE` |
| `input_trust` | 输入信任 / 提示组装如何对输入进行排名和隔离 | `TRUSTED_USER`, `UNTRUSTED_MULTI_PARTY_TRANSCRIPT`, `SANDBOX_SCRIPT`, `EXTERNAL_A2A_PAYLOAD`, `TOOL_PROVIDER_PAYLOAD`, `WORLD_CONTEXT`, `DIAGNOSTIC_INPUT` |
| `output_destination` | 输出目的地 / 输出候选可以提交到哪里 | `CANONICAL_CHAT`, `REALM_GROUP_MESSAGE_CANDIDATE`, `SCENARIO_TURN_CANDIDATE`, `WORLD_EVENT_CANDIDATE`, `EXTERNAL_REPLY_CANDIDATE`, `DIAGNOSTIC_CANDIDATE`, `EPHEMERAL` |
| `promotion_posture` | 提升姿态 / 非规范输出是否可以成为持久性内容 | `NOT_ALLOWED`, `EXPLICIT_CANDIDATE`, `EXPLICIT_COMMIT_FLOW`, `EXISTING_CANONICAL_POLICY` |
| `execution_concurrency` | 执行并发性 / 如何准入同时触发 | `CANONICAL_CHAT_BUDGET`, `PER_AGENT_PARTICIPATION_QUEUE` |

这些维度是正交的。配置文件将它们组合起来。

## 非规范姿态（默认）

默认情况下，**除了** `canonical_agent_chat` 之外，每个参与配置文件都是非规范的。非规范输出：

- 必须作为输出候选返回
- 默认情况下不得写入内存
- 默认情况下不得提交认知
- 默认情况下不得修改 Realm source-core
- 默认情况下不得成为规范聊天历史记录

提升到内存、认知、Realm source-core 或规范聊天需要**后续的显式提升权威**。不存在隐式提升。

## 已准入配置文件

配置文件在 `tables/agent-participation-profiles.yaml` 中获得准入。配置文件家族：

| 配置文件家族 | 用途 |
| --- | --- |
| `canonical_agent_chat` | 1:1 用户 ↔ 智能体聊天 |
| `realm_group_participation` | 智能体作为 Realm 群组线程中的一个槽位 |
| `scenario_sandbox_participation` | 智能体在场景包、运行或分支中活动 |
| `oasis_world_actor_participation` | 智能体作为 OASIS 世界中的一个角色活动 |
| `external_a2a_participation` | 智能体通过已准入的 A2A 网关可达 |
| `debug_participation` | 诊断/重放观察配置文件 |

每个配置文件都固定了九个维度上的特定值。

## 这对应用程序为何重要

应用程序如果希望智能体参与规范聊天之外的活动，**不能**自行创建其姿态。运行时要求应用程序绑定到一个已准入的配置文件。这正是防止“智能体在此处参与”意外地演变为“智能体读取一切、写入一切、提交一切”的关键。

## 读者场景：Realm 群组中的智能体

用户的智能体作为 Realm 群组线程中的一个槽位，与其他人类一起。

1.  **配置文件绑定。** 应用程序通过 `realm_group_participation` 绑定智能体。运行时验证配置文件。
2.  **记录所有者为 `REALM`。** 运行时不拥有群组线程真相；Realm 拥有。
3.  **输入信任为 `UNTRUSTED_MULTI_PARTY_TRANSCRIPT`。** 提示组装将群组消息的优先级排在运行时系统/策略/配置文件指令之下。
4.  **内存读取范围遵循二元排他性。** 智能体不会将用户的私有二元内存读取到群组上下文中。
5.  **输出目的地为 `REALM_GROUP_MESSAGE_CANDIDATE`。** 输出是一个候选；Realm 在提交前验证槽位绑定。
6.  **无隐式提升。** 智能体在群组中说的任何内容都不会成为规范智能体真相，除非有显式提升路径准入。

同一个智能体在与用户进行规范聊天时，拥有完整的读取范围和直接提交权限。配置文件正是保持这些上下文边界清晰的关键。

## 读者场景：OASIS 世界事件中的智能体

用户的智能体作为角色参与预定的 OASIS 世界事件。

1.  **配置文件绑定。** `oasis_world_actor_participation`。
2.  **记录所有者为 `OASIS_WORLD_DOMAIN`。** OASIS 拥有事件日志真相。
3.  **输入信任为 `WORLD_CONTEXT`。** 提示组装根据世界信任规则准入世界上下文叙事。
4.  **能力范围为 `DOMAIN_LIMITED`。** 智能体的常规工具并非都能带入世界；只有世界域能力获得准入。
5.  **输出目的地为 `WORLD_EVENT_CANDIDATE`。** 输出是世界域验证的候选。
6.  **内存写入为 `WRITE_NONE`。** 世界事件默认不写入持久智能体内存。

如果用户后续希望世界体验能影响其智能体的持久真相，则由已准入的提升流程显式处理。

## 读者场景：同一智能体，同时使用两个配置文件

用户的智能体在与用户进行规范聊天的同时，也在一个 Realm 群组中作为与其他人的槽位。

1.  **两个锚点，两个配置文件。** 与用户的规范聊天在一个锚点下使用 `canonical_agent_chat`；Realm 群组在另一个独立的锚点下使用 `realm_group_participation`。
2.  **并发性根据各维度规则获得准入。** `execution_concurrency` 维度准入每个智能体参与队列的语义；并发配置文件不会争夺规范聊天预算。
3.  **内存和能力范围按配置文件保持独立。** 群组配置文件不继承规范配置文件的授权。
4.  **审计沿袭跟踪两者。** 每个输出都可归因于其配置文件。

这正是“参与权威”的价值所在：同一个智能体可以同时在多个上下文中活动，而这些上下文之间不会相互渗透。

## 参与权威不涵盖什么

- 它不拥有 Realm 线程/成员资格/消息/读取状态真相——这些属于 Realm。
- 它不拥有场景包/运行/分支/重放真相——这些属于场景。
- 它不拥有 OASIS 世界/事件/本体真相——这些属于 OASIS。
- 它不拥有 A2A 或 MCP 线缆真相——这些是协议。
- 它不拥有桌面/网页/头像/模组 UI 状态。

## 来源依据

- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/runtime/kernel/tables/agent-participation-axis-model.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/agent-participation-axis-model.yaml)
- [`.nimi/spec/runtime/kernel/tables/agent-participation-profiles.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/agent-participation-profiles.yaml)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
