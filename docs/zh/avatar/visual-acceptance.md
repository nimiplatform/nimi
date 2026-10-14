# Avatar 视觉呈现验收

视觉呈现验收的目标是 Desktop 监督启动的 Avatar 窗口、当前受保护的 App 会话，以及所选模型的实际渲染输出。测试夹具解析、类型检查与本地诊断仅能覆盖各自的具体环节，单凭其中任何一项都无法证明端到端产品路径已经就绪。

## 准备真实路径

1. 准备配套匹配的 Runtime、SDK/Kit，以及经过校验的模型及其能力配置文件。
2. 启动 Runtime 与 Home，并在 Home 中完成登录。
3. 通过正式的调用方入口选中目标 Agent，由 Desktop 与 Runtime 重新校验启动意图和对话锚点。
4. 在受 Desktop 监督的 Avatar Electron 窗口中核对运行结果。虽然仓库根目录的 `pnpm dev:avatar` 提供了源码开发入口，但该命令本身既不会自动选择默认 Agent，也无法建立真实的会话与呈现就绪状态。

直接运行 Vite 预览、借助其他产品的渲染器窗口，或使用处于 `fixture_not_verified` 状态的夹具预览，均不能作为该验收目标的替代方案。

## 按变更验证结果

- **模型呈现**：所选的 Live2D 或 VRM 模型在真实的 Avatar 窗口中清晰可见，而非空白画布或诊断占位画面。
- **会话与交互**：当前 Agent/Conversation 绑定有效，交互通道与后端呈现均已就绪。
- **动作与表情**：触发受本次变更影响的受支持输入，观察对应模型的实际表现；待机状态或其他模型的表现不能作为验证依据。
- **窗口与碰撞区**：当涉及窗口尺寸（bounds）、缩放或穿透属性变更时，重点核实受影响的具体区域与交互操作；未涉及此类变更时无需重复无关检查。
- **失败与恢复**：遇到缺失或不受支持的输入时，应呈现对应的具体原因；后续恢复操作仍需满足有效的会话与呈现前提。

Live2D 的验收结果仅能覆盖实际验证的 Live2D 链路，不能直接推导至 VRM。截图、日志和自动化运行记录应当如实反映本次测试中实际观察到的行为。当前系统并未引入固定的像素网格、首帧数量门禁，也不存在 `recordCarrierVisualProof` 接口。

## 已有工程检查的范围

Avatar 的 `typecheck` 与 `test` 命令分别负责校验类型定义及单元测试覆盖的行为。仓库根目录的 `pnpm smoke:avatar-live2d` 仅用于检查所选已导入 Live2D 资产的文件结构、资源引用和依赖前提；它不会启动真实的 Avatar 渲染器，也无法验证屏幕像素输出或语音交互链路。

记录测试时所使用的会话、模型、渲染后端及实际观察到的结果即可。未运行的测试场景应如实标记为未验证，不得使用测试夹具的通过记录或来自其他渲染器的证据来替代产品验收。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
- [`apps/avatar/src/shell/renderer/app-shell/composition-state.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/composition-state.ts)
- [`apps/avatar/scripts/smoke-agent-center-live2d.mjs`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/scripts/smoke-agent-center-live2d.mjs)
- [`apps/avatar/package.json`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/package.json)
