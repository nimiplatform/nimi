# 权威域

按 Nimi 各权威域整理：每一域持有什么，不持有什么。

## 各权威域

| 域 | 持有 | 不持有 |
| --- | --- | --- |
| 平台 | 世界模型、六大基础协议、权威规则、App 切片准入、Hook Action Fabric 契约、AI Agent 安全接口 | 世界真相；AI 执行；App 集成；UI 渲染 |
| Runtime | AI 执行（文/图/视频/音/embedding/STT/TTS）、工作流、流式、多模态产物、本地能力路由、GPU 仲裁、模型生命周期、Agent 执行（Chat 轨 / Life 轨 / hook 调度）、Runtime 本地记忆、知识库、App 间消息、委派能力网关、输出防火墙、本地审计 | 世界真相；SDK 改写；UI；Cognition 权威；Realm 权威 |
| SDK | App 面接入面、表面契约、传输、错误改写、import 边界 | Runtime / Realm / Cognition / 桌面端的私有内部；新平台真相；Runtime 执行 |
| 桌面端 | 原生第一方外壳、原生桥接、mod 治理与 hook 能力白名单、窗口 / 菜单行为、本地集成边界、第一方用户工作流、外部 Agent 接入面板 | Runtime 执行；SDK 契约定义；Realm 真相；Avatar 形体权威 |
| 网页端 | 已准入桌面端面的浏览器受限改写 | 原生 Runtime 启动；mod 注册；原生窗口；超出浏览器安全边界的敏感 token 持久化 |
| Realm | 世界真相、世界状态、世界历史、聊天、社交、经济、资产、通行、绑定、资源、bundle | Runtime 执行；SDK 改写；桌面端 UI 决策；Cognition 记忆权威 |
| Avatar | Agent 形体呈现、形体改写、载体视觉准入、后端分支（Live2D / VRM / 生成式动作）、Agent 脚本、Avatar 事件面 | Agent 身份（归 Runtime）；Agent 记忆（归 Cognition）；世界真相（归 Realm）；生成（归 Runtime） |
| Cognition | 独立的记忆、知识、prompt 服务、引用、完成关卡、技能服务、runtime 桥接契约、runtime 升级契约 | Runtime 执行；Realm 真相；Avatar 形体；桌面端 UI |
| Nimi Coding | 议题 / wave / packet / preflight / 审计 / 收口方法论、四级闭合框架、角色分离策略、权威收敛策略、forbidden-shortcuts 目录、宿主无关边界、声明的技能 | Runtime 执行；产品代码；AI 宿主实现；provider 调用 |

## 域间关系

| 边 | 方向 | 承载 |
| --- | --- | --- |
| `mods ↔ desktop` | 双向 | 进程内 hook 运行时 |
| `desktop → nimi-sdk` | 单向 | 统一开发者面 |
| `desktop → nimi-runtime` | 单向 | gRPC runtime 接入 |
| `nimi-apps → nimi-realm` | 单向 | REST + WS realm 接入 |
| `nimi-runtime ↔ nimi-cognition` | 双向桥 | Runtime 使用 Cognition；Cognition 保留权威 |
| `nimi-runtime ↔ nimi-realm` | 同级 | 互不依赖；由 SDK 桥接 |

## 边界规则

| 边界 | 规则 |
| --- | --- |
| App 必须通过 SDK | App 不能 import Runtime / Realm 私有内部；SDK 是边界 |
| SDK 不重定义真相 | SDK 改写上游契约；不发明新的产品真相 |
| Mod 必须通过 hook 能力 | Mod 使用已准入的 hook 能力；不能绕开直连 raw runtime |
| Runtime 不吸收 Cognition | 桥接契约只是使用；权威留在 Cognition |
| Cognition 不重定义 Realm | 记忆和知识不是世界真相 |
| 网页端不能伪装原生 | 网页端适配器禁用浏览器无法兑现的能力 |
| Avatar 不重定义 Agent | 呈现是身份的下游 |

## 授权预设

| 预设 | 读 | 写 | 委派 |
| --- | --- | --- | --- |
| `readOnly` | 是 | 否 | 否 |
| `full` | 是 | 是 | 否 |
| `delegate` | 是 | 是 | 一层 |

## App 模式

| 模式 | 读 | 写 | 单世界活跃数 |
| --- | --- | --- | --- |
| `render-app` | 是 | 否 | 多个 |
| `extension-app` | 是 | 是 | 至多一个活跃 |

## Source Basis

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
