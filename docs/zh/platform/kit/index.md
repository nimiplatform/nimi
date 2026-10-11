# Platform Kit

`@nimiplatform/kit` 为 Nimi App 提供通用的 UI 组件与宿主接入构件。开发者可以开箱即用地共享视觉设计语言、无障碍交互规范、Shell 适配器以及常用组件原语，同时业务逻辑与核心数据权威依然严格归属于 App 与对应的底层模块。

## 核心职责模块

| 模块子路径 | 核心定位与职责 |
| --- | --- |
| `ui` | 共享设计 Token、主题方案与基础 UI 组件原语 |
| `auth` | 开箱即用的用户认证交互组件与适配层 |
| `core` | 宿主环境无关的基础工具库与能力辅助函数 |
| `telemetry` | 渲染层遥测与 Error Boundary 错误边界组件 |
| `shell/tauri` | 专为 Tauri 环境提供的轻量 Rust 宿主接入胶水代码 |

Kit 遵循按需演进原则：仅当多个应用或宿主环境存在明确的复用诉求、且所有权边界清晰时，才会沉淀为公共模块。Kit 避免过度设计，不盲目为了表面的“生态完整”而预先堆砌未验证的冗余组件。

## 宿主环境支持：Electron 与 Tauri

Nimi App 默认推荐在由 Desktop 调度的 Electron 宿主环境中开发与运行，其默认构建产物也面向 Electron，承载完整的标准能力 Shell。

Tauri 作为一个轻量级可选的构建目标，由共享的 Tauri Crate 承载标准能力的一个受限子集：

- **Tauri 支持的能力**：会话状态查询、App AI 配置（AIConfig）、单次文本生成（`generateCandidate`）、Artifact 产物上传、App 本地存储（JSON 文档与静态资源）、Realm World 与 PersonaCharacter 基础操作、共享 Agent AIConfig、Agent 基础管理（自主性、形象、记忆控制、具身状态）以及 App Activity 记录。
- **Tauri 暂不支持的能力**：流式文本会话、Scenario 复杂执行与 Job 调度、Artifact 文件下载读取、语音音色资源管理、Realm 实时音视频与聊天通道、Agent 协作推荐与工作流、第三方 Integrations 集成、实时音视频交互、媒体播放器原生句柄、Avatar 宿主交接以及 Resource Pack 资源包导入。
- **调用行为**：在 Tauri 宿主中调用上述暂不支持的能力时，调用将在底层命令分发前直接以 `capability-unavailable`（原因代码 `tauri-standard-shell-operation-unsupported`）显式报错返回。App 自身在 Tauri 中注册的私有命令不受影响。

## 职责所有权边界

Kit 的职责聚焦于可复用的呈现层逻辑与宿主无关的交互行为，坚决不越界承担：

- App 特定的业务工作流、页面排版与产品决策；
- Runtime 层的 LocalAgent、Conversation、Memory、Knowledge 或就绪状态管理；
- Realm 层的虚拟世界、角色设定、账户或社交图谱权威状态；
- Avatar 核心执行管线或骨骼渲染引擎的底层权威；
- AI Provider 路由分发、后端执行或权限校验逻辑。

App 仅需通过公开的子路径按需引入 Kit，并在本地灵活组合组件。App 不应直接引用 Kit 的内部私有路径，也不应在 App 内部重新发明已被 Kit 良好封装的共享原语。

## 典型场景：复用共享确认对话框 (Dialog)

应用需要使用与系统一致、且符合无障碍规范的确认弹窗：

1. **按需引入**：App 从 `@nimiplatform/kit/ui` 导入标准的 `Dialog` 组件以及语义 Token。
2. **定义业务内容**：App 自主定义弹窗的提示文案、表单内容与操作响应函数。
3. **委托交互细节**：Kit 自动处理键盘导航、焦点捕捉管理 (Focus Trap) 与无障碍语义属性。
4. **权责清晰**：产品业务决策完全留在 App，底层交互规范与视觉一致性由 Kit 保障。

视觉系统的设计原则请参阅[设计模式](/zh/platform/kit/design-pattern)，在实际项目中引入与配置 Kit 请参阅[在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)。

## Source Basis

- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
