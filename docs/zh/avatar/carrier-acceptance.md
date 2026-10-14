# Carrier 视觉呈现验收

**Carrier** 是承载角色具身呈现的宿主表面（当前为独立桌面端 Avatar 窗口与视口）。Carrier 视觉呈现验收定义了 Avatar 如何校验渲染后端、检查模型资源完整性、管理渲染状态，以及控制产品交互的开放条件。

## 渲染后端选择与校验

Avatar 当前仅支持 **`live2d`** 与 **`vrm`** 两种渲染后端，并由单一 Avatar 工厂在启动图形管线前完成校验：

| 输入条件 | 验收结果 |
| --- | --- |
| 经校验的 `live2d` 或 `vrm` 类型且资源完整 | 接受：初始化对应的渲染后端分支 |
| 未知、不明或未校验的后端类型 | 拒绝：直接中止，不替换为占位分支（placeholder branch） |
| 模型资源缺失、无效或解析失败 | 不可用（`unavailable`）：直接失败，不以占位或兜底材料谎报加载成功 |

## 资源完整性与交互准入

Carrier 不进行残缺的静默半渲染，也不会用替代素材掩盖损坏的资源包：

- **Live2D 严格资源校验**：Live2D 模型必须提供唯一的 `model3` 定义，以及全部必需的 `MOC3`、纹理和已声明资源。任一必需资源缺失、无效或解析失败时均无法呈现，系统绝不会使用 placeholder 或 fallback 材料报告成功。
- **产品交互就绪门槛**：无模型或后端呈现未就绪时，不开放产品交互；开发 fixture 能够渲染不计入产品 `ready` 状态。

## 渲染状态与受控回退边界

在运行过程中，Carrier 渲染分支（`backend-branch.ts`）通过四个状态管理呈现生命周期：

- `loading`：正在校验并加载后端与模型资源。
- `ready`：后端呈现已就绪；开放产品交互还需有效的 App 会话、Runtime 绑定、驱动与模型条件。
- `recovering`：渲染后端正在内部恢复暂时性故障。
- `unavailable`：校验未通过、必需资源缺失或后端无法完成渲染。

**受控回退的实际范围：**
- **视口几何边界（`surfaceBounds`）**：当窗口或视口尺寸需要适配时，Carrier 允许使用已配置的受控边界回退（bounded bounds fallback）。系统**不会**把高复杂度 3D VRM 模型自动转换为低模或 2D 静态快照。
- **后端内部恢复**：暂时性渲染故障由当前后端在内部自行恢复（`recovering`），不涉及跨引擎替换或资源包会话热更新。

## 职责边界

Avatar 是平台上的普通受保护应用（governed App），不享有越权特权。语义身份、对话与呈现事实仍归属各自的上游所有权模块：

| 关注维度 | 归属职责 |
| --- | --- |
| 角色持久身份与关系 | 由 Realm 负责 |
| 智能体执行与对话会话 | 由 Runtime 负责 |
| 长期记忆 | 由 Cognition 负责 |
| 视觉渲染与视口边界 | 由 Avatar Carrier 本地处理 |

渲染失败仅代表当前视觉呈现不可用，既不证明 Agent 离线，也不能证明 Agent 在线；Avatar 状态变化不会改写 Agent 的身份、记忆或会话事实。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/carrier/backend-branch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/carrier/backend-branch.ts)
