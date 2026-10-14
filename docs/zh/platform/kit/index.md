# Platform Kit

`@nimiplatform/kit` 为 Nimi App 提供通用的 UI 组件与宿主接入构件。开发者可直接复用统一的视觉设计系统、无障碍交互规范、Shell 适配层与常用组件原语；业务逻辑与底层领域权威则始终由 App 本身及对应的平台服务维护。

## 核心职责模块

| 模块子路径 | 核心定位与职责 |
| --- | --- |
| `ui` | 共享设计 Token、主题方案与基础 UI 组件原语 |
| `auth` | 开箱即用的用户认证交互组件与适配层 |
| `core` | 宿主环境无关的基础工具库与能力辅助函数 |
| `telemetry` | 渲染层遥测与 React 错误边界 (Error Boundary) 组件 |
| `shell/tauri` | 专为 Tauri 环境提供的轻量 Rust 宿主接入胶水层 |

Kit 遵循按需演进原则：仅当多个应用或宿主环境存在明确的复用诉求、且所有权边界清晰时，才会沉淀为共享模块；避免过度抽象与超前设计，不为形式上的完整而堆砌未验证的组件。

## 宿主环境支持：Electron 与 Tauri

Nimi App 默认推荐在由 Desktop 调度的 Electron 宿主环境中开发与运行，其构建产物默认面向 Electron，承载完整的标准能力 Shell。

Tauri 则是轻量级的可选构建目标，由共享的 Tauri Crate 提供标准能力的一个受限子集：

- **Tauri 支持的能力**：会话状态查询、App AI 配置（AIConfig）、单次文本生成（`generateCandidate`）、Artifact 产物上传、App 本地存储（JSON 文档与静态资源）、Realm World 与 PersonaCharacter 基础操作、共享 Agent AIConfig、Agent 基础管理（自主性、形象、记忆控制、具身状态）以及 App Activity 记录。
- **Tauri 暂不支持的能力**：流式文本会话、Scenario 复杂执行与 Job 调度、Artifact 文件下载读取、语音音色资源管理、Realm 实时音视频与聊天通道、Agent 协作推荐与工作流、第三方 Integrations 集成、实时音视频交互、媒体播放器原生句柄、Avatar 宿主交接以及 Resource Pack 资源包导入。
- **调用行为**：在 Tauri 宿主中调用上述暂不支持的能力时，调用将在底层命令分发前直接以 `capability-unavailable`（原因代码 `tauri-standard-shell-operation-unsupported`）显式报错返回。App 自身在 Tauri 中独立注册的私有命令不受影响。

## 职责所有权边界

Kit 的职责聚焦于可复用的呈现层模式与宿主无关的交互行为，不越界承担以下底层职责：

- App 特定的业务工作流、页面布局与产品决策；
- Runtime 层的 LocalAgent、Conversation、Memory、Knowledge 或就绪状态管理；
- Realm 层的虚拟世界、角色设定、账户或社交图谱权威状态；
- Avatar 核心执行管线与骨骼渲染引擎的底层权威；
- AI Provider 路由分发、后端执行与权限校验逻辑。

App 通过公开子路径按需引入 Kit 并在本地组合组件，不应直接依赖 Kit 的内部私有路径，也不应在 App 内重复实现 Kit 已封装成熟的共享原语。

## 典型场景：复用共享确认对话框 (Dialog)

应用需要接入平台统一、且符合无障碍标准的确认弹窗：

1. **按需引入**：App 从 `@nimiplatform/kit/ui` 导入标准 `Dialog` 组件与所需语义 Token。
2. **定义业务内容**：App 自行定义提示文案、表单内容与交互响应逻辑。
3. **委托交互细节**：Kit 自动处理键盘导航、焦点捕获 (Focus Trap) 与无障碍语义标注。
4. **权责分明**：业务决策与逻辑留在 App 内部；Kit 提供共用的视觉与无障碍组件，App 仍需检查实际组合后的界面与交互。

视觉系统的设计原则请参阅[设计模式](/zh/platform/kit/design-pattern)，在实际项目中引入与配置 Kit 请参阅[在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)。

## Source Basis

- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
