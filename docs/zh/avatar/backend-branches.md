# 渲染后端分支

Avatar 体系支持两种标准的图形渲染后端，枚举范围严格受限封闭：`live2d | vrm`。由 Avatar 内部统一的分支工厂进行模型资产校验，并自动实例化适配的渲染管线。模型资源包或第三方 App 无法在运行时动态注入未经规范准入的私有渲染器。

## 统一分支接口规范

所有渲染分支均实现相同的、引擎中立的结构体接口：

| 接口字段 / 方法 | 核心定位与职责 |
| --- | --- |
| `kind` | 经校验的渲染分支判别符：`'live2d' | 'vrm'` |
| `nominalBounds` | 模型的逻辑尺寸正数标称值及归一化的身体中心坐标 |
| `projection` | 响应活动、情绪、骨骼动作、微表情与状态重置的标准交互接口 |
| `surface` | 由 Avatar 宿主统一管理的 React/WebGL 渲染视口组件 |
| `metadata()` | 返回分支内部的不透明诊断与排错指标 |
| `shutdown()` | 彻底释放当前分支占用的 WebGL 上下文、显存纹理与音频缓冲 |

宿主外壳仅面向这组通用接口编程。特定图形后端的内部细节与着色器句柄不会穿透溢出至跨端呈现层。

## Live2D 后端分支

Live2D 分支负责加载并校验 Cubism 模型资产，在 WebGL 画布上完成渲染绘制，基于网格图层实时计算高精度的 Alpha 穿透遮罩，并通过音频处理流驱动嘴部开合。系统仅为 Live2D 分支提供底层的 `setParameter` 参数直写扩展；Avatar 内部的交互转换层必须在显式完成类型收窄后方可调用。

## VRM 三维骨骼分支

VRM 分支负责加载经过验证的 3D VRM 角色模型及其强类型能力配置文件 (Capability Profile)。能力配置详细记录 Humanoid 人形骨骼映射、形态键 (Blendshapes)、眼部注视追踪 (LookAt) 支持、关节角度限制以及受支持的确定性动作路由。若模型缺少必要骨骼或表情，对应的动作指令将显式失败阻断，杜绝骨骼畸变或虚假成功。

VRM 是 Avatar 已经正式支持的官方渲染分支，具备完善的骨骼与材质支持，而非临时占位符。

## 独立分层动画规范（Nimi2D）

Nimi2D 属于独立的分层动画规范包，不属于 Avatar 当前闭合的 `live2d | vrm` 渲染后端枚举。若未来规划扩展新后端，须经正式规范评审，不混入当前生效的后端枚举中。

## 引擎中立的呈现管线

Runtime 的交互结果作为强类型语义输入进入 Avatar。Avatar 先将其保持在引擎无关的语义层面，再由激活的当前分支转译为特定渲染器的底层指令：

| 语义意图输入 | 分支转译执行示例 |
| --- | --- |
| 活动 (Activity) 或动作 (Motion) | 转译为 Live2D 动作组或 VRM 骨骼动画轨道 |
| 情绪 (Emotion) 或表情 (Expression) | 转译为 Live2D 表情插值参数或 VRM BlendShape 权重 |
| 语音发音 (Speak) | 转译为音频采样流与实时唇形权重分配 |
| 界面碰撞边界 | 转译为分支标称尺寸与实时 Alpha 像素碰撞遮罩 |

重置与关闭操作仅清理 Avatar 本地的渲染资源，不干扰 Runtime 底层的对话历史与会话连续性。

## 典型场景：分支自动判定与加载

1. **资产受权**：Runtime 授权指定的视觉资产包。
2. **沙盒加载**：原生宿主在隔离目录下加载资产文件。
3. **清单结构校验**：Avatar 校验模型 Manifest 与资源完整性。
4. **工厂实例化**：分支工厂自动选择并实例化对应的 `live2d` 或 `vrm` 分支。
5. **异常阻断**：若模型格式未知、能力声明缺失或尺寸非法，宿主外壳坚决维持在非就绪状态，向用户展示明确排错信息。

扩展新的图形渲染后端需要经过严肃的架构评审与完整的强类型协议实现，系统不采用未经测试的松散插件形式。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/nimi2d/asset-package.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
