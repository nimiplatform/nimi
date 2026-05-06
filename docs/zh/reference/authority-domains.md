# 权威域

每个 Nimi 权威域拥有什么、**不**拥有什么的参考表。

## 域

| 域 | 拥有 | **不**拥有 |
| --- | --- | --- |
| Platform | 世界模型、六个协议基础协议、权威规则、App slice 准入、Hook Action Fabric 合同、AI agent 安全接口 | 世界真相；AI 执行；App 集成；UI 渲染 |
| Runtime | AI 执行（文本/图像/视频/音频/embedding/STT/TTS）、工作流、流式、多模态 artifact、本地能力路由、GPU 仲裁、Model 生命周期、Agent 执行（Chat Track / Life Track / hook 调度）、runtime 本地记忆、知识 bank、App 间消息、委派能力闸口、输出 firewall、本地审计 | 世界真相；SDK 边界；UI；Cognition 权威；Realm 权威 |
| SDK | App 面访问面、surface 合同、transport、错误形状、import 边界 | Runtime / Realm / Cognition / Desktop 内部；新平台真相；runtime 执行 |
| Desktop | 原生一等方外壳、原生桥接、mod 治理 + hook 能力白名单、窗口/menu 行为、本地集成边界、一等方用户工作流、外部 Agent 接入面板 | Runtime 执行；SDK 合同定义；Realm 真相；Avatar 形体化权威 |
| Web | 准入桌面端面的受约束浏览器版本 | 原生 runtime bootstrap；mod 注册；原生窗口；超出浏览器安全限的敏感 token 持久化 |
| Realm | 世界真相、世界状态、世界历史、聊天、社交、经济、资产、通行、绑定、resource、bundle | Runtime 执行；SDK 边界；桌面端 UI 决定；Cognition 记忆权威 |
| Avatar | 形体化 Agent 呈现、形体化呈现、载体视觉接受度、后端分支（Live2D / VRM / 生成式动作）、Agent script、Avatar 事件面 | Agent 身份（Runtime）；Agent 记忆（Cognition）；世界真相（Realm）；生成（Runtime） |
| Cognition | 独立记忆、知识、prompt 服务、引用、completion 闸门、技能服务、runtime 桥合同、runtime 升级合同 | Runtime 执行；Realm 真相；Avatar 形体化；桌面端 UI |
| Nimi Coding | Topic / wave / packet / preflight / 审计 / closeout 方法学、四闭合框架、角色分离 policy、权威收敛 policy、禁用捷径目录、宿主无关边界、声明技能 | Runtime 执行；产品代码；AI host 实现；provider 调用 |

## 跨域关系

| 边 | 方向 | 装载 |
| --- | --- | --- |
| `mods ↔ desktop` | 双向 | 进程内 hook runtime |
| `desktop → nimi-sdk` | 单向 | 统一开发者面 |
| `desktop → nimi-runtime` | 单向 | gRPC runtime 访问 |
| `nimi-apps → nimi-realm` | 单向 | REST + WS realm 访问 |
| `nimi-runtime ↔ nimi-cognition` | 双向桥 | Runtime 消费 cognition；cognition 保留权威 |
| `nimi-runtime ↔ nimi-realm` | 同侪 | 谁都不依赖谁；SDK 桥接 |

## 边界规则

| 边界 | 规则 |
| --- | --- |
| App 必须用 SDK | App **不能** import 私有 Runtime / Realm 内部；SDK 是边界 |
| SDK **不**重新定义 | SDK 投上游合同；**不**发明新产品真相 |
| Mod 必须用 hook 能力 | Mod 消费准入 hook 能力；**不能**绕进原始 runtime |
| Runtime **不能**吸纳 Cognition | 桥合同是消费；权威留 Cognition |
| Cognition **不能**重新定义 Realm | 记忆与知识**不是**世界真相 |
| Web **不能**暗含桌面端原生 | Web adapter 禁浏览器满足不了的能力 |
| Avatar **不能**重新定义 Agent | 呈现在身份的下游 |

## 授权预设

| Preset | 读 | 写 | 委派 |
| --- | --- | --- | --- |
| `readOnly` | 是 | 否 | 否 |
| `full` | 是 | 是 | 否 |
| `delegate` | 是 | 是 | 一级 |

## App 模式

| 模式 | 读 | 写 | 每个世界活跃数 |
| --- | --- | --- | --- |
| `render-app` | 是 | 否 | 多个 |
| `extension-app` | 是 | 是 | 至多一个活跃 |

## 来源

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/platform/kernel/app-slice-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/app-slice-admission-contract.md)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/spec/platform/kernel/governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/governance-contract.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdk/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/index.md)
- [`.nimi/spec/desktop/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/index.md)
- [`.nimi/spec/desktop/web-adapter.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/web-adapter.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/avatar/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/index.md)
- [`.nimi/spec/cognition/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/index.md)
