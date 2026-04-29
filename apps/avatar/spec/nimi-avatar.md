# Nimi Avatar (阿凡达) Product Guide

This file is guide-only. Normative Nimi Avatar authority lives in [kernel/index.md](kernel/index.md).

## Product Positioning

Nimi Avatar 是桌面悬浮 embodiment carrier，是 Nimi agent 的视觉化身。不是常规软件窗口，而是**桌面小程序**形态：

- 形象本身就是 UI
- 透明背景、无 chrome、always-on-top
- 大小跟随当前 embodiment surface bounds + companion surface footprint 自动调整
- 可在桌面 embodiment-stage 区域拖拽移动（companion 区域不开启 drag）
- 点击 pet 身体响应（表情 / motion 等），点击 pet 外区域穿透到下层 app
- Companion Surface（assistant bubble + status row + composer）固定 always-visible，不依赖外部 trigger button

### 核心差异点

Avatar 是普通 local first-party Nimi app，但不是传统聊天窗口：

- 不是"带头像的聊天软件" — companion surface 是紧凑浮动 stack（最近消息 + status + 输入），不展开成 transcript 历史
- 不是"桌面宠物玩具" — agent 的 life state / posture / memory 驱动真实行为
- 不是"单一渲染后端展示器" — NAS handler 让第三方 embodiment package creator 定制具体投影行为；当前 shipped backend branch 只是 Live2D

### 多种交互方式

- **Window drag**：拖动 pet 到桌面任意位置（仅 embodiment-stage 内部区域）
- **Click on pet body**：触发对应 NAS event handler（如点 head 害羞）
- **Companion composer**：text input + send，提交一个 bounded text turn（始终可见）
- **Companion mic toggle**：foreground STT 输入，绑定当前 anchor（始终可见）
- **Companion bubble**：最近 assistant message + close × button
- **Foreground voice via runtime**：foreground STT 输入 + same-anchor bounded assistant reply captions
- **Same-anchor text continuity**：bubble / input 显式绑定当前 `agent_id + conversation_anchor_id`，不做 same-agent conversation fallback
- **Foreground voice continuity**：voice 入口、pending/reply-active cue、caption reveal、interrupt 都显式绑定当前 `agent_id + conversation_anchor_id`，不做 wake-word / background continuation

## Target Users

### Primary: End User

使用桌面 embodiment avatar 陪伴 / 对话的用户：

- 希望 agent 形象一直在桌面（always-on）
- 希望随时可对话（companion stack 始终在角落，无需 trigger）
- 希望 agent 有 life（主动状态变化，不只是响应）

### Secondary: Embodiment Package Creator / 第三方开发者

为自己的 embodiment package 写 NAS handler 的开发者：

- 内容作者：提供 backend package + NAS handlers (`nimi/` 目录) 就能 ship 完整 agent 角色
- 生态参与者：创造带 programmable 行为的 agent avatar，可以独立分发

NAS convention（见 `kernel/agent-script-contract.md`）把 agent semantics 投影到 embodiment backend API；当前 shipped branch 仍由 Live2D API 覆盖 motion / parameter / expression / pose / wait 等能力。

## Non-Goals

Nimi Avatar 当前**不**追求：

- 多 agent 同屏（一次一个 agent）
- Full chat experience（长历史 / 多线程 / 文件上传）— 由 desktop app 承载；avatar companion bubble 仅展示当前 anchor 最近一条 assistant message
- 新 backend branch 的 shipped implementation（当前仍只有 Live2D；VRM / 3D 作为 future rendering backend）
- Global hotkey system（companion stack 始终可见，不需要 hotkey 唤起）
- Mobile / web thin client（future 可能通过 thin client protocol）
- Multi-user agent（每个 avatar 对应一个 agent，一个 runtime 一个 user scope）

## AI Surface Summary

Nimi Avatar 消费 Nimi runtime 的 agent data，通过 embodiment projection layer + NAS handler 驱动当前 backend branch：

- Activity events → NAS activity handlers → backend motion / expression
- Posture changes → NAS event handlers → backend pose / 姿态调整
- Lipsync frame batch → Live2D `ParamMouthOpenY` 桥（Wave 3 admit）
- Voice playback timeline → audio playback 与 lipsync 时间同步（runtime monotonic_with_wall_anchor）
- User interactions → emit `avatar.user.*` / `avatar.companion.*` events → runtime observes
- Cross-app events：通过 `avatar_instance_registry` projection 协调 desktop chat / avatar instance lifecycle

当前正常启动路径使用 runtime/SDK consume chain。Mock scenario 仍保留，但只在显式 fixture mode 下参与；runtime 不可用时不会 silent fallback 到 mock。

当前 canonical 启动模型固定为：

- normal path 必须带 Desktop-selected minimal launch intent
- launch intent 只包含 required `agent_id`、optional `avatar_instance_id`、
  optional non-authoritative `launch_source`
- Desktop 不传递 scoped binding、visual package、conversation anchor、
  runtime/world、account/user、Realm/auth/token truth
- 缺少 launch context 或缺少 `agent_id` 必须 fail closed；Avatar app 不得默认
  bootstrap 单个 agent
- Runtime bootstrap 通过 SDK local first-party Runtime client；Avatar 以
  `nimi.avatar` local first-party app 身份读取 Runtime account projection，并仅
  通过 Runtime-issued short-lived access token 访问授权私有数据
- Avatar 通过 SDK local first-party Runtime-backed token provider 为
  `runtime.agent` turns API 获取 request-time protected access token；默认
  启动路径不 issue scoped binding
- visual bootstrap 通过 Runtime account projection + launch `agent_id` 解析本机
  Agent Center package；当前 shipped carrier branch 是 Live2D，VRM / 3D 仍是
  future backend branch，不能伪成功
- conversation bootstrap 由 Avatar 创建或恢复 Avatar-owned Runtime anchor；本地
  recovery cache 只按 Runtime account projection + `agent_id` +
  `avatar_instance_id` 索引，并且必须经 Runtime snapshot 校验后才能复用
- Avatar 不读取 shared auth、不创建 Realm HTTP client、不做 login bootstrap、
  不拥有 refresh token、durable auth/session/user truth 或 app-local JWT subject
  truth
- bounded close handoff 只允许携带 `avatar_instance_id` 和 surface attribution；
  avatar app 负责按 live instance identity 执行 close，缺少 target 时 fail closed

当前 running-session posture 固定为 first-party Runtime revalidation。下列规则
supersede 早期 shared desktop auth session / scoped-binding default launch 描述：

- Runtime 拥有 auth、session、refresh-token custody、account projection 与
  Runtime-issued short-lived access token authority
- Desktop 只拥有 launch intent，不拥有 Avatar visual package、conversation
  anchor、account/user、Realm/auth/token truth
- Avatar 只消费 minimal launch intent、本机 Runtime/SDK projections、以及
  Runtime-authorized local Agent Center package
- Runtime first-party bootstrap 不可用时，Avatar 必须按 `app-shell-contract.md`
  §6 surface composition 切换到对应 degraded composition state（保留 ready 主区
  的混合渲染是禁止的）
- 只要本地已授权 visual package 有效，Runtime account state 的 typed degraded
  state 不得伪造成 package success 或 auth success
- user-facing degraded copy 必须使用 Runtime/account/session 语言，不出现 CORS
  workaround 或 shared auth truth

Recovery posture 与 surface composition 联动：

- user-facing surface 可以给出 calm degraded copy、explicit reload/relaunch guidance、以及 desktop launch-context update notice
- recovery affordance 只允许 reload / relaunch 当前 shell；不得在 avatar app 内新增 runtime fallback
- launch-context update、anchor rebind、或 relaunch 前，avatar-local transient bubble / draft / foreground voice UI 必须清空，避免 stale state 跨 continuity 泄漏

## Product Form 详细

### Surface Composition (`kernel/app-shell-contract.md`)

Avatar shell 的渲染由 composition state 驱动（`ready` / `loading` / `degraded:*` / `error:*` / `relaunch-pending` / `fixture:active`），三类 surface 互斥：

- **embodiment-stage**：占据主区，渲染当前 backend branch 的形象；window drag 仅在此区开启
- **companion-surface**：固定 always-visible，三层结构（assistant-bubble / status-row / composer），定位于 embodiment-stage 一角
- **degraded-surface**：替代上述两者，承载 loading / error / reauth / launch-context-invalid / relaunch-pending 信息架构

### Window Behavior (`kernel/app-shell-contract.md`)

- 透明背景（`decorations: false, transparent: true`）
- Always-on-top default
- Dynamic size 跟随 embodiment surface bounds + companion footprint
- Window drag：仅 embodiment-stage 内部，companion 区域不开启 drag
- Click-through：embodiment 形状外 + companion-surface 矩形外的区域穿透鼠标事件到下层 app
- Settings popover 仅暴露 4 个 avatar-shell-local toggle（`always_on_top` / `bubble_auto_open` / `bubble_auto_collapse` / `show_voice_captions`），不扩写成 workstation-style panel

### Companion Surface (`kernel/app-shell-contract.md` §7)

- assistant-bubble：当前 anchor 最近一条 assistant message + close × button
- status-row：mic toggle、mode label、speaker indicator、settings cog
- composer：text input + send，Enter 提交一个 bounded text turn

### Live2D Rendering (`kernel/live2d-render-contract.md`)

这是当前 shipped backend-specific branch：

- Cubism SDK for Web 官方集成
- 从 `<model>/runtime/*.model3.json` 加载
- Expression / motion / pose 官方 API 封装
- Physics / lipsync 官方能力默认启用，lipsync 与 runtime presentation timeline 联动（Wave 3 admit）

### NAS Runtime (`kernel/agent-script-contract.md`)

- 扫描 `<model>/runtime/nimi/activity/` / `event/` / `continuous/` / `lib/`
- 自动注册 handlers
- 正常启动路径下，handlers 的 contexts 来自 desktop-selected launch context + runtime/SDK consume bundle
- 显式 fixture mode 下，handlers 的 contexts 可由 mock scenario 注入
- handlers 消费 embodiment projection API；当前 shipped backend branch 由 Live2D 实现该 API

### Mock Fixture Driver (`kernel/mock-fixture-contract.md`)

显式 fixture mode 通过 `mock.json` 或 scenario 文件驱动 activity events：

```json
{
  "scenario": "basic-emotion-cycle",
  "events": [
    { "kind": "time", "at_ms": 0, "type": "runtime.agent.presentation.activity_requested", "detail": { "activity_name": "happy", "category": "emotion", "source": "mock" } },
    { "kind": "time", "at_ms": 3000, "type": "runtime.agent.presentation.activity_requested", "detail": { "activity_name": "sad", "category": "emotion", "source": "mock" } },
    { "kind": "time", "at_ms": 6000, "type": "runtime.agent.presentation.activity_requested", "detail": { "activity_name": "greet", "category": "interaction", "source": "mock" } }
  ]
}
```

## Wave Schedule

Avatar 重构分 5 个 wave，每个 wave 必须是端到端可交付能力切片：

| Wave | 主题 | 交付内容 |
|---|---|---|
| **0** | Spec 重构 | `app-shell-contract.md` / `nimi-avatar.md` / `feature-matrix.yaml` / `avatar-event-contract.md` / `agent-presentation-stream-contract.md` admit；nimi-coding spec validators 通过 |
| **1** | Surface composition | `embodiment-stage/` + `companion-surface/` + `degraded-surface/` 子模块完整实现；App.tsx 重写为三选一渲染；删除 trigger toggle 路径与 ready 区 diagnostic 残留 |
| **2** | i18n + Design tokens | `locales/{en,zh}/avatar.json` 完整文案；i18n 框架接通；`app-shell/tokens.css` design system；BEM 化全部组件；`i18n-keys.yaml` spec 表 |
| **3** | Lipsync 端到端 | runtime `lipsync_frame_batch` / `voice_playback_requested` 实现链路（如缺失补完 emitter）；SDK 消费 lipsync queue；avatar `live2d/lipsync-bridge.ts` 投到 `ParamMouthOpenY`；voice-companion-state lipsync slice |
| **4** | Window + Settings 工业化 | dynamic window bounds (embodiment + companion footprint)；drag region 限定到 embodiment-stage；settings popover 替换主区 4-toggle 大块；`window-bounds-policy.yaml` spec 表 |

每个 wave 完工后必须跑：

- nimi-coding spec validators（`validate-spec-tree` / `validate-spec-audit` / `validate-spec-governance` / `validate-ai-governance` / `generate-spec-derived-docs --check`）
- avatar 全套（`typecheck` / `test` / `lint` / `cargo check` / `cargo test`）
- Wave 3 触发 runtime go test
- Wave 1+ 实机端到端验证

## Wave-by-Wave Reading Path

- **Wave 0 spec authority**：`kernel/app-shell-contract.md`、`kernel/avatar-event-contract.md`、`kernel/tables/feature-matrix.yaml`
- **Wave 1 surface composition**：`kernel/app-shell-contract.md` §6-§8（surface composition / companion / degraded）
- **Wave 2 i18n + tokens**：`kernel/tables/i18n-keys.yaml`（admitted）、`kernel/app-shell-contract.md` §4.2 + §7.9 settings popover
- **Wave 3 lipsync**：`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` + `kernel/avatar-event-contract.md` §2.2 (`avatar.lipsync.frame` / `avatar.speak.*`) + `kernel/live2d-render-contract.md`
- **Wave 4 window**：`kernel/app-shell-contract.md` §1-§3 + `kernel/tables/window-bounds-policy.yaml`（待 admit）

通用上游：

- shell / window / drag / click-through：`kernel/app-shell-contract.md`
- embodiment projection protocol：`kernel/embodiment-projection-contract.md`
- Live2D 接入 / model 加载：`kernel/live2d-render-contract.md`
- NAS handler 系统：`kernel/agent-script-contract.md`
- Mock fixture 规则：`kernel/mock-fixture-contract.md`
- Event 语义：`kernel/avatar-event-contract.md`
- 默认 activity → motion 映射：`kernel/tables/activity-mapping.yaml`
- Wave 边界：`kernel/tables/feature-matrix.yaml`

## Known Defects Outside Authority

（开发初期，暂无已知缺陷）

## Relationship to Desktop App

Nimi Avatar 和 Desktop App 仍然是两个 first-party app，但当前 owner-domain 关系已经固定成 bridge / handoff，而不是旧的"avatar app 自己默认 boot"模型：

- Desktop app 是 multi-instance avatar launcher / orchestrator
- Avatar app 是唯一 first-party avatar carrier line
- Desktop 负责显式 handoff：`agent_id`、`avatar_instance_id`、以及 anchor targeting
- Avatar app 负责 consume handoff、加载本地 visual package、并通过 runtime IPC 建立 real runtime/SDK carrier path
- Desktop handoff 只传 target selection，不传 raw JWT、subject identity、或 Realm endpoint
- Avatar 自身不签发默认 scoped runtime binding；desktop 也不透传 binding
  material。Explicit binding-only mode 另受 `K-BIND-*` 约束

## Relationship to Runtime Refactor

RuntimeAgent 的 admitted consume surface 已经成为 `apps/avatar` 的 primary carrier line：

- normal path 使用 desktop-selected launch context + local visual package + runtime IPC bridge + SDK consume
- mock fixtures 继续保留为 explicit fixture / integration test corpus
- runtime 不可用时 interaction/voice/activity fail closed，不允许 silent downgrade 到 mock；进入 degraded composition state 卸载 ready surface
- Wave 3 admit 后 runtime presentation timeline 中的 `lipsync_frame_batch` / `voice_playback_requested` 必须实际产生，且与 SDK 消费链路、avatar Live2D 桥接共同闭合
