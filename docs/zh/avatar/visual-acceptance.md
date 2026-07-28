# 视觉验收

## 状态：已准入契约；Avatar 拥有的测试 surface

Avatar 载体视觉验收契约已在内核层级获得准入。证据分类体系、故障关闭边界以及多后端证据形态均已确定。自动化验收工具属于 Avatar 拥有的测试 surface；并非所有证据类别都是公开应用 API。

## “视觉验收”的含义

Avatar 应用的载体——由 `apps/avatar` 拥有的 canvas / WebGL 表面——必须针对已准入的后端生成可见的非占位符像素，并具备确定性、可审计的证据。视觉验收是一项契约，它规定了**哪些证据被允许用于完成该证明**。

这种严格性是刻意的，因为 Avatar 载体路径是唯一的实际产品路径；桌面聊天应用的独立 Live2D 渲染器并非 Avatar 载体。

## 证据类别

| 类别 | 含义 | 能否完成载体视觉证明 |
| --- | --- | --- |
| 真实运行时路径 | 桌面启动上下文 + 本地 Agent Center 包 + 运行时 IPC 桥接 + SDK 驱动 + Avatar 载体 | 是 |
| 确定性工具 | 受控的 Avatar 应用工具，通过稳定输入执行真实的载体绘制路径 | 是，如果它执行 Avatar 载体 canvas / WebGL 路径 |
| 夹具 / 模拟 | 显式 `VITE_AVATAR_DRIVER=mock` 或模拟场景数据源 | 仅作为回归证据 — 不能完成载体证明 |
| 桌面渲染器证据 | 桌面聊天 Live2D 渲染器冒烟测试或像素证据 | 否 |
| 已关闭主题证据 | 来自旧主题的历史工件 | 否 |

前两项可以完成证明。后三项不能。

## 所需视觉证明

载体视觉证明必须包含以下方面的当前可执行证据：

-   由 `apps/avatar` 拥有而非桌面聊天应用拥有的 canvas（或等效的 WebGL 主机）
-   通过 Avatar 应用后端分支的模型加载成功
-   模型加载后，载体路径至少生成一帧非占位符可见像素
-   当实现声称支持响应式表面行为时，提供针对尺寸调整或主机边界变化的弹性证据
-   显示缺少/无效模型输入不会渲染占位符成功状态的失败证据

该证明可以通过单元/集成测试、确定性无头工具或 Playwright 风格的验收工具进行自动化。无论采用何种方法，都必须记录足够的工件细节，以便后续审计。

## 禁止完成证明

以下证据**不得**用于完成 Avatar 载体视觉证明：

-   桌面聊天 Live2D 像素测试，即使它们通过桌面渲染器执行 Cubism WebGL
-   没有非占位符像素证据的静态 `<canvas>` 存在
-   只用夹具回放，却声称它是真实 Runtime 载体路径
-   已关闭主题的演示截图、检查清单或工作器结果
-   不执行绘制/像素输出的仅命令状态测试

故障关闭是明确要求。没有已准入证据的成功声明属于
`placeholder_success` 捷径，系统会拒绝。

## 多后端视觉证明

`recordCarrierVisualProof` 已扩展 `modelKind: BackendKind` 字段，以便载体能够按后端接受证据：

```ts
recordCarrierVisualProof(input: {
  modelKind: 'live2d' | 'vrm';
  // ... existing fields (canvas ref / sample grid / frame index / ...)
}): CarrierVisualProof;
```

适用按后端划分的规则。Live2D 证据仅证明 Live2D 分支。VRM 证据仅证明 VRM 分支。禁止跨后端重用证据。

## 读者场景：完成 Live2D 载体证明

1.  **运行确定性工具。** Avatar 工具挂载 Live2D 后端，加载夹具层模型，驱动规范的活动序列。
2.  **捕获采样网格。** 在确定性帧索引处进行像素采样；断言身体区域存在非占位符像素。
3.  **记录证明。** 使用采样网格 + canvas 引用 + 帧索引 + 工具 ID 调用 `recordCarrierVisualProof({ modelKind: 'live2d', ...})`。
4.  **审计。** 审计员从记录的工件中重放工具；重放必须重现相同的证据。

该证明被准入，因为它通过确定性输入执行了载体绘制路径，并生成了可审计的工件细节。

## 读者场景：一次被禁止的完成证明尝试

一位贡献者提议使用桌面聊天应用的 Live2D 像素测试来完成载体证明。

1.  **拒绝。** 桌面聊天 Live2D 渲染器是一个独立的实现。它不执行 Avatar 载体 canvas。
2.  **理由代码。** "根据 `carrier-visual-acceptance-contract.md` 第3节，桌面渲染器证据不能完成载体视觉证明。"
3.  **重新规划。** 贡献者转而构建一个 Avatar 载体确定性工具。

此契约依据此规则禁止此类行为，因为混合渲染器证明会掩盖实际工作的路径。

## 边界摘要

| 关注点 | 所有者 |
| --- | --- |
| 可观察视觉结果与故障关闭边界 | Avatar |
| 后端像素写入路径 | 当前 Live2D、VRM 或 Nimi2D 分支 |
| 视觉包能力要求 | 经过验证的后端能力配置 |
| 桌面聊天 Live2D 渲染器 | 桌面（独立；绝不作为 Avatar 载体证明） |

## 来源依据

-   [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
