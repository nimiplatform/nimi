# Avatar 视觉呈现验收

验证对象是 Desktop 监督启动的 Avatar 窗口、当前受保护 App 会话以及所选模型的真实输出。夹具解析、类型检查和本地诊断分别覆盖自己的行为，不能单独证明这条产品路径可用。

## 准备真实路径

1. 准备匹配的 Runtime、SDK/Kit 与已验证的模型和能力配置。
2. 启动 Runtime 与 Home，并完成 Home 登录。
3. 通过正式调用方入口指定当前 Agent，由 Desktop 与 Runtime 重新校验启动意向和对话锚点。
4. 在 Desktop 监督的 Avatar Electron 窗口中检查结果。源码开发入口为仓库根的 `pnpm dev:avatar`，但启动命令本身不选择默认 Agent，也不证明会话和画面已就绪。

直接 Vite、另一产品的渲染器或 fixture_not_verified 预览不能替代这个对象。

## 按变更验证结果

- **模型呈现**：所选 Live2D 或 VRM 模型在真实 Avatar 窗口可见，不是空画布或诊断占位。
- **会话与交互**：当前 Agent/Conversation 绑定有效，产品交互与后端呈现均已就绪。
- **动作与表情**：触发本次改变的受支持输入，观察对应模型结果；不把待机或另一模型的输出当作成功。
- **窗口与碰撞**：涉及尺寸、缩放或穿透时，验证实际改变的区域和操作；没有这类变更则不重复无关检查。
- **失败与恢复**：缺失或不支持的输入显示对应原因，恢复后仍需有效会话与呈现条件。

Live2D 结果只支持实际验证的 Live2D 路径，不能证明 VRM。截图、日志和自动化结果只用于说明本次真实观察到的行为，不采用已退役的固定像素网格、首帧数量或 recordCarrierVisualProof 接口。

## 已有工程检查的范围

Avatar 的 typecheck 与 test 分别检查类型和测试实际覆盖的行为。仓库根 `pnpm smoke:avatar-live2d` 检查所选已导入 Live2D 资产的结构、引用与相应文件条件；它不启动 Avatar renderer，也不证明真实像素输出或语音交互。

记录检查使用的会话、模型、后端和实际结果即可。未运行的场景如实标为未验证，不用通过的夹具或其他 renderer 结果补成产品成功。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
- [`apps/avatar/src/shell/renderer/app-shell/composition-state.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/composition-state.ts)
- [`apps/avatar/scripts/smoke-agent-center-live2d.mjs`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/scripts/smoke-agent-center-live2d.mjs)
- [`apps/avatar/package.json`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/package.json)
