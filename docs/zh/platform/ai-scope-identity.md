# AIConfig 的权威归属与作用域

AI 运行配置（AIConfig）在当前已认证账号下拥有明确且唯一的权威所有者（Owner）。在系统设计中，Owner 严格分为两类：由标准应用标识符声明的独立 App，以及该账号下所有本地智能体共用的 Runtime 智能体子系统。

| 使用方场景 | 所使用的 AIConfig 归属 |
| --- | --- |
| 第三方独立 App | 该 App 自身的专属 AIConfig |
| Nimi Home 内置的 Nimi Chat | Desktop App 宿主环境的 AIConfig |
| 智能体对话（Agent Chat，包括不同的 LocalAgent） | 本地智能体子系统全局共用的 AIConfig |

单个智能体（Agent）、会话（Conversation）、业务模块、窗口、标签页或路由均不是 AIConfig 的独立所有者。在客户端切换不同的 Agent 对话，不会随之切换为智能体私有的模型路由配置。智能体个性特征、具身呈现形式与长期记忆开关属于独立的 Agent 属性，与全局 AI 路由解耦管理。

## 通过安全客户端进行配置管理

第三方应用通过 `client.aiConfig` 读取和保存自身的配置项；账号主体与 App 身份由底层的受保护会话自动识别，调用方无需且无法伪造 owner 参数。全局智能体配置属于特权路径，需要具备 `agent.configure` 权限，同样不允许随意指定 Agent 选择器。Nimi Home 仅负责呈现和管理当前已授权映射的 App 配置。

配置更新遵循乐观锁版本控制机制：应用应先读取当前配置及其版本标识（Revision），并在保存完整能力列表时附带该 Revision。未在列表中声明的能力将被清除。若保存时发生版本冲突，应重新拉取最新配置由用户进行复核，严禁静默覆盖他人更新。

## 配置与本地机器硬件的解耦

每项能力配置记录了标准功能诉求、可移植的默认参数与明确的执行路由（Route）。本地路由（Local）仅作为路由标记；云端路由（Cloud）则记录当前账号已绑定的连接器引用（Connector）、能力实现（CapabilityImplementation）以及目标模型。本地具体的硬件算力组合（Local Loadout）及设备当前选用的底层推理引擎，由 Runtime 的独立设备级存储统一管控。

应用 AI 预设模板（AIProfile）仅生成可供编辑的表单预填内容，不会静默保存 AIConfig，也不会修改全局机器的硬件选择。保存配置与确认设备级模型切换属于两步独立操作，不同所有者之间不存在隐式继承或自动回退。

## 生命周期

App AIConfig 的生命周期与该应用在系统中的安装生命周期绑定。共用的 LocalAgent 配置持久存在，不会随单个智能体的创建、切换或删除而受影响。界面临时状态或注册批次不会派生出额外的配置所有者。

开发者可参阅 [AIConfig 客户端接口](/zh/sdk/ai-config-surface) 了解调用方式，在客户端中的操作可参阅 [AI 配置指南](/zh/desktop/ai-profile-config)。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
