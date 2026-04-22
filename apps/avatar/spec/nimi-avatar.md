# Nimi Avatar (阿凡达) Product Guide

This file is guide-only. Normative Nimi Avatar authority lives in [kernel/index.md](kernel/index.md).

## Product Positioning

Nimi Avatar 是桌面悬浮 Live2D 角色，是 Nimi agent 的视觉化身。不是常规软件窗口，而是**桌面小程序**形态：

- 形象本身就是 UI
- 透明背景、无 chrome、always-on-top
- 大小跟随 Live2D model bounds 自动调整
- 可在桌面任意位置拖拽移动
- 点击 pet 身体响应（表情 / motion 等），点击 pet 外区域穿透到下层 app

### 核心差异点

Avatar **不是普通软件**：

- 不是"带头像的聊天软件" — chat UI 是轻量 bubble + 浮动输入，不是常驻 window
- 不是"桌面宠物玩具" — agent 的 life state / posture / memory 驱动真实行为
- 不是"Live2D 展示器" — NAS handler 让第三方 model creator 定制具体 Live2D 行为

### 多种交互方式

- **Window drag**：拖动 pet 到桌面任意位置
- **Click on pet body**：触发对应 NAS event handler（如点 head 害羞）
- **Small button trigger**：点击触发 chat bubble（Phase 2）
- **Voice I/O via runtime**：STT 输入 / TTS 输出 + lipsync（Phase 2）
- **Text chat via bubble**：最近一条消息 + 浮动输入框（Phase 2）

## Target Users

### Primary: End User

使用桌面 Live2D avatar 陪伴 / 对话的用户：

- 希望 agent 形象一直在桌面（always-on）
- 希望随时可对话（点击 / 快捷 trigger）
- 希望 agent 有 life（主动状态变化，不只是响应）

### Secondary: Live2D Model Creator / 第三方开发者

为自己的 Live2D model 写 NAS handler 的开发者：

- 美术作者：提供 Live2D model + NAS handlers (`nimi/` 目录) 就能 ship 完整 agent 角色
- 生态参与者：创造带 programmable 行为的 agent avatar，可以独立分发

NAS convention（见 `kernel/agent-script-contract.md`）允许完整的 Live2D SDK 调用能力（motion / parameter / expression / pose / wait），覆盖复杂交互（eye tracking / sequence / state machine 等）。

## Non-Goals

Nimi Avatar 当前**不**追求：

- 多 agent 同屏（Phase 1 一次一个 agent）
- Full chat experience（长历史 / 多线程 / 文件上传）— 由 desktop app 承载
- 3D / VRM model rendering（Phase 1 只 Live2D；3D 作为 future rendering backend）
- Global hotkey system（Phase 2 通过小 button 激活 chat，不做 hotkey）
- Mobile / web thin client（future 可能通过 thin client protocol）
- Multi-user agent（每个 avatar 对应一个 agent，一个 runtime 一个 user scope）

## AI Surface Summary

Nimi Avatar 消费 Nimi runtime 的 agent data，通过 NAS handler 驱动 Live2D rendering：

- Activity events → NAS activity handlers → Live2D motion / expression
- Posture changes → NAS event handlers → Live2D pose / 姿态调整
- Voice level stream → lipsync handler → `ParamMouthOpenY` 参数
- User interactions → emit `avatar.user.*` events → runtime observes
- Cross-app events（future）：subscribe desktop chat 事件做协调反应

Phase 1 所有 AI data 都是 mock（通过 scenario 文件驱动），runtime 不实际参与。

## Product Form 详细

### Window Behavior (`kernel/app-shell-contract.md`)

- 透明背景（`decorations: false, transparent: true`）
- Always-on-top default
- Dynamic size 跟随 model bounds
- Window drag：整个 pet 可拖到桌面任意位置
- Click-through：pet 形状外的区域穿透鼠标事件到下层 app（避免挡住别的 app）

### Live2D Rendering (`kernel/live2d-render-contract.md`)

- Cubism SDK for Web 官方集成
- 从 `<model>/runtime/*.model3.json` 加载
- Expression / motion / pose 官方 API 封装
- Physics / lipsync 官方能力默认启用

### NAS Runtime (`kernel/agent-script-contract.md`)

- 扫描 `<model>/runtime/nimi/activity/` / `event/` / `continuous/` / `lib/`
- 自动注册 handlers
- 触发 handlers 的 contexts 是 mock data（Phase 1）
- Live2D API v1 封装给 handlers 使用

### Mock Driver (`kernel/mock-fixture-contract.md`)

Phase 1 通过 `mock.json` 或 scenario 文件驱动 activity events：

```json
{
  "scenario": "basic-emotion-cycle",
  "events": [
    { "at_ms": 0, "type": "apml.state.activity", "detail": { "activity_name": "happy" } },
    { "at_ms": 3000, "type": "apml.state.activity", "detail": { "activity_name": "sad" } },
    { "at_ms": 6000, "type": "apml.state.activity", "detail": { "activity_name": "greet" } }
  ]
}
```

## Phase 1 Reading Path

- shell / window / drag / click-through：`kernel/app-shell-contract.md`
- Live2D 接入 / model 加载：`kernel/live2d-render-contract.md`
- NAS handler 系统：`kernel/agent-script-contract.md`
- Mock 数据驱动：`kernel/mock-fixture-contract.md`
- Event 语义：`kernel/avatar-event-contract.md`
- 默认 activity → motion 映射：`kernel/tables/activity-mapping.yaml`
- Phase 边界：`kernel/tables/feature-matrix.yaml`

## Known Defects Outside Authority

（开发初期，暂无已知缺陷）

## Relationship to Desktop App

Nimi Avatar 和 Desktop App 是**独立 first-party app**，两者都连接同一 Nimi runtime：

- Desktop app 承载 full chat experience（长历史 / 多线程）
- Avatar 承载轻量 bubble + 悬浮交互
- 两者通过 event bus 跨 app 协调（subscribe 对方 namespace events，通过 runtime 中转）
- Phase 1 不做 cross-app integration，先让 avatar 独立跑通

## Relationship to Runtime Refactor

RuntimeAgent 当前正在 `.nimi/local/report/ongoing/2026-04-19-runtime-agent-service-architecture/` 下大重构。Nimi Avatar Phase 1 采用 **mock-driven development**：

- Mock data 模拟 runtime events / APML stream / agent state
- App 以产品级质量开发（不是 prototype）
- Phase 2 runtime 重构完成后，只替换 data source 层（mock → real SDK），app logic 不变
- Mock fixtures 将成为 integration test corpus 验证 real runtime 行为一致性
