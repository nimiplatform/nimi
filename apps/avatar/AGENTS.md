# Nimi Avatar AGENTS.md

> Authoritative module-level instructions for AI agents working on Nimi Avatar.

## Identity

- **App name (Chinese)**: 阿凡达
- **App name (English)**: Nimi Avatar
- **Runtime app ID**: `nimi.avatar`
- **Tauri bundle identifier**: `ai.nimi.apps.nimi.avatar`
- **One-line**: 桌面悬浮 embodiment carrier，agent 的视觉化身；通过 NAS handler 把 agent semantics 投影到当前 backend branch。
- **Status**: Productization gate active. Surface composition, i18n/design tokens, lipsync end-to-end, and window/settings contracts are admitted and implemented. Real runtime/SDK consume path is primary; mock is explicit fixture-only.

## Architecture

| Layer | Technology | Location |
|-------|-----------|----------|
| Desktop shell | Tauri 2 (transparent, always-on-top, no-chrome) | `src-tauri/` |
| Frontend | React 19 + Vite 7 + Tailwind 4 | `src/shell/renderer/` |
| Carrier abstraction | Kit `BackendBranch` contract; app-local backend factory/orchestration | `@nimiplatform/kit/features/avatar` + `src/shell/renderer/carrier/` |
| Embodiment projection | Kit `BackendProjection` / cue projection contracts; app-local NAS runtime wiring | `@nimiplatform/kit/features/avatar` + `src/shell/renderer/nas/` |
| Live2D backend branch | Cubism SDK for Web (official) | `src/shell/renderer/live2d/` |
| VRM backend branch | `@pixiv/three-vrm` + `@react-three/fiber` + `wlipsync` | `src/shell/renderer/vrm/` |
| Nimi2D backend branch | `@nimiplatform/nimi2d` + `pixi.js` | `src/shell/renderer/nimi2d/` |
| Audio pipeline | Kit headless audio pipeline; app consumes runtime artifact bytes (S-RUNTIME-111) | `@nimiplatform/kit/features/avatar` + avatar voice/lipsync wiring |
| State | Zustand | `src/shell/renderer/app-shell/` |
| AI / Events | `@nimiplatform/sdk` real consume path | workspace dep |
| UI components | `@nimiplatform/kit/{ui,core,auth,telemetry}` + admitted `@nimiplatform/kit/features/avatar` reusable surface | workspace dep |
| Dev port | 1427 | `vite.config.ts` |

## Product Form

Nimi Avatar 不是常规软件窗口，而是 **桌面悬浮 embodiment surface**：

- 透明背景（形状跟随当前 embodiment backend 产出的 surface bounds + companion-surface footprint）
- 无 title bar / close / minimize buttons
- Always-on-top default
- Window drag 仅在 embodiment-stage 区域开启；companion / degraded 区域不开启 drag
- Click-through 在 embodiment 形状外 + companion 矩形外（点空白穿透到下层 app）
- Companion Surface（assistant bubble + status row + composer）固定 always-visible，绑定当前 launch-selected `agent_id + conversation_anchor_id`
- Degraded Surface 单独承载 loading / error / reauth / launch-context-invalid / relaunch-pending 形态，与 ready surface 互斥
- STT / TTS 通过 runtime 消费；audio bytes 通过 `runtime.artifacts.readArtifactBytes` 获取；lipsync 由 backend `BackendAudioConsumer` + wLipSync 驱动

## Admitted Capability Status

以下仅是 `.nimi/spec/avatar/kernel/tables/feature-matrix.yaml` 当前能力状态的只读摘要，不定义任务编排、阶段状态或 AI host 工作流。

| Group | 能力 | 状态 |
|---|---|---|
| 0 | Spec 重构（surface composition / companion / degraded / event 体系 / feature matrix） | done |
| 1 | Surface composition implementation（embodiment-stage / companion-surface / degraded-surface 三互斥结构 + hard-cut 旧 toggle 路径） | done |
| 2 | i18n + Design tokens 工业化（locales/{en,zh}/avatar.json + tokens.css + app-owned key-catalog.yaml） | done |
| 3 | Voice / lipsync end-to-end（runtime voice emitter + SDK 消费 + backend lipsync driver + voice-companion-state slice） | done（Avatar app consume path is voice/audio + backend lipsync；`lipsync_frame_batch` is not consumed under `apps/avatar/src/**`） |
| 4 | Window + Settings 工业化（dynamic window bounds + drag region 限定 + settings popover + window-bounds-policy.yaml） | done |
| 5 | Spec admit + platform admission（multi-backend BackendBranch / VRM contract / audio-pipeline + wLipSync / runtime-artifact-contract K-AGCORE-053 / S-RUNTIME-111） | done |
| 6 | Carrier abstraction extraction + Live2D refactor + audio pipeline + frame_batch hard-cut | done |
| 7 | VRM lifecycle + MToon + framing + diagnostics + instance cache | done |
| 8 | VRM generated motion + emote state + projection adapter + activity mapping v2 | done（runtime motion support is generated-provider based；`.vrma` is interchange-only unless a real file is admitted） |
| 9 | Window bounds multi-backend + alpha-mask hit region + drag region | done |
| 10 | Smoke evidence + representative samples | done（21-run deterministic headless matrix；launch readiness 仍以真实 app 验收为准） |

工程原则：

- 项目未上线，不留 retired compatibility shim；retired v1 feature-phasing 框架已废弃
- 不做 MVP / 不做半成品中间态；每次修改都必须端到端交付
- spec 先行（`.nimi/spec/avatar/kernel/**` 与 `.nimi/spec/**`），spec admit 后再做实现
- 不做伪实现 / 伪返回；i18n、design tokens、lipsync 必须真实接通
- 外部 AI host 独占任务编排；nimi-coding 仅提供已保留的方法论、spec 工具与确定性门禁

## Spec Authority & Sync

`.nimi/spec/avatar/**` is Nimi Avatar's admitted first-party authority root. Normative content belongs under `.nimi/spec/avatar/kernel/*.md` and `.nimi/spec/avatar/kernel/tables/**`; `.nimi/spec/avatar/index.md` and `.nimi/spec/avatar/nimi-avatar.md` are guides.

### Migrated Contract Lineage

The following contracts are admitted first-party Avatar authority. Earlier
derivation history remains in Git and is not an active truth surface:

- `.nimi/spec/avatar/kernel/agent-script-contract.md` — Avatar agent-script contract
- `.nimi/spec/avatar/kernel/avatar-event-contract.md` — Avatar event contract

### Platform-Level Upstream

Platform contracts are consumed from active `.nimi/spec/**` authority:

- APML wire format → `.nimi/spec/runtime/kernel/agent-output-wire-contract.md`
- APML LLM compliance → `.nimi/spec/runtime/kernel/agent-output-wire-contract.md`
- Activity ontology → `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` and `.nimi/spec/runtime/kernel/tables/agent-activity-ontology.yaml`
- HookIntent / event owner map → `.nimi/spec/runtime/kernel/agent-hook-intent-contract.md` and `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
- SDK runtime consume surface → `.nimi/spec/sdks/kernel/runtime-contract.md`
- Presentation Timeline boundary → `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`

Nimi Avatar-specific contracts in `.nimi/spec/avatar/kernel/**` do not re-define upstream; they define Avatar-local behavior and downstream implementation binding.

### Key Tables

| Table | Governs |
|-------|---------|
| `feature-matrix.yaml` | Admitted Avatar capability and delivery matrix（v2 schema） |
| `activity-mapping.yaml` | Kit Avatar activity route table consumed by concrete Live2D / VRM backends |
| `scenario-catalog.yaml` | Dev/test fixture scenarios |
| `window-bounds-policy.yaml` | Dynamic window sizing rules |

### Sync Rules

```
Rule → Table → Generate → Check → Evidence
```

1. Modify YAML table or contract first
2. Regenerate compiled TS constants
3. Run `pnpm --filter @nimiplatform/avatar check:spec-consistency`
4. Update code to match
5. Run full test suite

**Drift = CI failure.**

## Development Principles

### No Legacy, No Shims

Nimi Avatar starts from zero. No compatibility layers, no "simple first" shortcuts, full product quality from day one. Mock layer is clearly bounded（`src/shell/renderer/mock/`）and remains fixture-only; runtime/SDK path is the current primary carrier line.

### Fail-Close

- Missing model folder → display error UI, not silent fallback
- NAS handler syntax error → reject handler + log, do not silently fall to default
- Unknown activity name（超出 ontology core + extended + mod-declared）→ fallback to convention motion group + log warn
- Embodiment backend load failure → display error UI, not empty canvas
- Runtime/bootstrap unavailable → app does not start; do not fall back to mock unless `VITE_AVATAR_DRIVER=mock` is explicit
- Mock scenario file invalid → explicit fixture boot does not start

## Hard Boundaries

### Mock vs Real Data Source

Normal app boot is **sdk/runtime-backed**. Mock remains bounded to explicit fixture mode (`VITE_AVATAR_DRIVER=mock`) and test corpus. Code-level data source boundaries must stay explicit（via module path `src/shell/renderer/mock/` vs `src/shell/renderer/sdk/`）, and runtime failures must not silently downgrade to mock.

### Window Behavior

- Transparent background 强制（非 option）
- No title bar / no close/min buttons on the Avatar window
- Always-on-top default（配置可覆盖）
- Click-through outside active embodiment surface bounds（hit-region 计算）
- Dynamic window size 跟随 active embodiment surface bounds

### Live2D SDK Licensing

Cubism SDK for Web 按 Live2D 官方 licensing terms 使用。App bundle 仅包含 Cubism runtime；不 redistribute 任何 Live2D 官方 sample models。Model creators for Nimi Avatar 各自负责其 model 的 Live2D 分发授权。

### Cubism 5 (r.5) Integration Pitfalls — READ BEFORE DEBUGGING LIVE2D

**Version naming**（避免混淆）：
- **Cubism Editor**: 5.3 (latest editor version)
- **Cubism SDK for Web**: `5-r.5` (latest SDK release; `r.N` = release number, NOT "5.N")
- **Cubism Core**: 6.0.1 (binary lib bundled with SDK 5-r.5)
- 我们用 `5-r.5`，pinned in `vite.config.ts` (`CUBISM_WEB_SDK_VERSION`). 不要降回 r.3 — desktop app 用 r.3 但缺 r.5 的新功能 (blend modes, copy shaders)。

**Required init sequence** for r.5 (官方 sample reference: `lappmodel.ts:518-524`):

```ts
this.createRenderer(width, height);
const renderer = this.getRenderer();
renderer.startUp(gl);
renderer.setIsPremultipliedAlpha(true);
renderer.loadShaders(shaderPath);  // ← R.5 新增必需调用！缺则 vertex attribute mismatch
// then bindTexture / resize
```

`loadShaders` 是 r.5 b1de66b commit 引入的新 init 调用（旧 r.3 不需要，drawModel 内部 lazy load）。**漏调会报 `WebGL: INVALID_OPERATION: glDrawElements: Vertex shader input type does not match`** — fail mode 看起来像 GL state 错乱，实际是 shader programs 没编译/链接。

**Default framebuffer caching**（官方 sample: `lappsubdelegate.ts:74-76`）：

```ts
// init 时（在 createRenderer/startUp 之前）cache，此时 binding 是 canvas default (null)
this.defaultFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);

// renderFrame 里：
offscreen.beginFrameProcess(gl);   // ← 内部会切走 FBO binding 到 mask render target
try {
  renderer.setRenderState(this.defaultFramebuffer, viewport);  // ← 必须用 cached default，不能用 getParameter
  renderer.drawModel(shaderPath);
}
```

**绝对不要**在 `beginFrameProcess` 之后才 `gl.getParameter(FRAMEBUFFER_BINDING)` —— 那时拿到的是 offscreen mask FBO，drawModel 会画到 mask buffer 而不是 canvas。表现：canvas 完全空白但 status=ready / drawables 非零 / visible_pixels 误报有值。

**WebGL2 required**（不能 fallback WebGL1）：
- Cubism r.5 用 `gl.copyBufferSubData` 做 clip mask buffer copy，这是 WebGL2-only API
- 强制 WebGL1 会 fail with `WebGL2RenderingContext is required for buffer copy`
- macOS WKWebView 默认 WebGL2 (`WebKit WebGL` renderer, GLSL ES 3.00) — 兼容

**Projection matrix for portrait window**（官方 sample: `lapplive2dmanager.ts:96-103`）：

```ts
if (model.getCanvasWidth() > 1.0 && width < height) {
  // wide model on portrait window
  modelMatrix.setWidth(2.0);                    // 在 resize() 调，避免每帧 drift
  projection.scale(1.0, width / height);
} else {
  projection.scale(height / width, 1.0);
}
```

`setWidth/setHeight` **只在 resize()** 调，写入 `baseModelMatrix`；renderFrame 每帧 `setMatrix(baseModelMatrix)` 复位，**不要**在 renderFrame 里调 `setWidth(2.0)` —— per-frame 累积 scale drift 会让 model 消失。

**Shader assets** 必须存在 `src/shell/renderer/public/assets/js/live2d-cubism-framework-shaders/WebGL/`（13 个文件，r.5 比 r.3 多了 blend / copy shaders）。`vite.config.ts` 的 `ensureCubismFrameworkCache` 自动从 SDK zip 解压并复制。

### Live2D Debugging Workflow

**Devtools access**（avatar 透明无边框窗口右键菜单被吞，devtools 默认打不开）：
- `apps/avatar/src-tauri/src/main.rs` 的 `build_avatar_window` 后已加 `#[cfg(debug_assertions)] window.open_devtools()`
- 必须从 desktop 启动 avatar 才能复现 launch context（直接 `open .app` 没 launch context 看不到内容）

**Live dev with real Runtime handoff**：

```bash
# Uses the latest Avatar instance registry under NIMI_APP_DATA_ROOT or ~/Nimi,
# starts tauri dev, passes the launch URI as an app arg, and serves renderer
# changes through Vite HMR.
pnpm dev:avatar

# If no prior Desktop launch exists:
pnpm dev:avatar --agent-id local-agent:<owner_user_id>:<runtime_source_ref>
```

**Build + launch debug bundle**：

```bash
# 1. Build debug bundle
pnpm --filter @nimiplatform/avatar exec tauri build --bundles app --no-sign --debug

# 2. 让 desktop 启动 debug bundle 而非 release（同一 shell 跑 desktop dev）
export NIMI_AVATAR_APP_PATH="$PWD/apps/avatar/src-tauri/target/debug/bundle/macos/Nimi Avatar.app"
pnpm --filter @nimiplatform/desktop tauri dev
```

`apps/desktop/src-tauri/src/main_parts/defaults_and_commands/window_and_logs.rs:337` 的 `open_avatar_handoff_uri_or_binary` 优先读 `NIMI_AVATAR_APP_PATH` env。

**Diagnostic console snippets**（在 avatar webview devtools 跑）：

```js
// 1. Check carrier status (drawables, visible pixels, error)
document.querySelector('[data-testid=avatar-live2d-carrier-visual]').dataset

// 2. Check GL context (WebGL2 + GLSL ES 3.00 expected)
const c = document.querySelector('canvas.avatar-live2d-carrier__canvas');
const gl = c.getContext('webgl2');
console.log({ version: gl.getParameter(gl.VERSION), glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION) });

// 3. Snapshot current canvas frame (绕过 CSS / 合成层，看 GL 真实输出)
//    visible/blank/garbage 决定 root cause 在 GL 还是 DOM
const c = document.querySelector('canvas.avatar-live2d-carrier__canvas');
const img = new Image();
img.src = c.toDataURL();
img.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;border:2px solid red;background:#fff;width:200px;height:auto;';
document.body.appendChild(img);
```

**`visiblePixels` stat 解读**：carrier 在 24×24=576 grid 上 sample 像素。**156/576 = 27% 是正常 model 显示比例**，不是"几乎不可见"。0 / 接近 0 才是真问题。

**`readPixels` 在 console 二次 `getContext` 不可信** — Tauri webview 二次 getContext 可能拿到不一致 context，读到 system memory garbage（如 `(55, 51, 49, 255)` 这种均匀暗色）。**始终以 `toDataURL` 为 ground truth**。

### Symptom → Root Cause Map

| Symptom | Likely root cause | Fix reference |
|---|---|---|
| `INVALID_OPERATION: glDrawElements: Vertex shader input type does not match` | `loadShaders` 没调 | 上文 init sequence |
| `WebGL2RenderingContext is required for buffer copy` | 强制 WebGL1 | 必须 WebGL2 |
| Canvas blank (`toDataURL` 空白) but status=ready / drawables>0 | 画到了 offscreen mask FBO | 上文 framebuffer caching |
| Model visible but 全部 cropped 在边缘 | projection 公式或 modelMatrix scale 错 | 上文 projection 公式 |
| Model 每帧逐渐缩小消失 | renderFrame 里调了累积型 `setWidth/setHeight` | 把它移到 resize() |
| `Live2DCubismCore not available within timeout` | `index.html` 没加载 cubismcore.min.js | 检查 `src/shell/renderer/index.html` script tag |
| Banner "Live2D Cubism SDK Core Version 6.0.1" 打两次 | 已知 cosmetic，不影响功能（双 framework loader 都 hit `s_isStarted` guard）| 可忽略 |

### Reference Resources

**Authoritative SDK refs**（GitHub upstream，按优先级）：

> SDK 文件本地存在 `apps/avatar/.cache/assets/js/CubismSdkForWeb-5-r.5/...`（首次 `pnpm dev` / `tauri build` 自动从 zip 解压），但 `.cache` 是 **gitignored**。先 link GitHub URL，本地 `.cache/` 路径仅在已 build 后可用作离线 mirror。

1. `lappmodel.ts` — canonical model lifecycle (init / setupModel / draw / release)  
   <https://github.com/Live2D/CubismWebSamples/blob/5-r.5/Samples/TypeScript/Demo/src/lappmodel.ts>
2. `lapplive2dmanager.ts` — projection logic per frame  
   <https://github.com/Live2D/CubismWebSamples/blob/5-r.5/Samples/TypeScript/Demo/src/lapplive2dmanager.ts>
3. `lappsubdelegate.ts` — framebuffer caching pattern  
   <https://github.com/Live2D/CubismWebSamples/blob/5-r.5/Samples/TypeScript/Demo/src/lappsubdelegate.ts>
4. `cubismshader_webgl.ts` — shader source layout (CubismWebFramework repo)  
   <https://github.com/Live2D/CubismWebFramework/blob/5-r.5/src/rendering/cubismshader_webgl.ts>

**External docs**：
- Cubism SDK manual: <https://docs.live2d.com/en/cubism-sdk-manual/>
- Editor 5.3 compat (matches SDK 5-r.5): <https://docs.live2d.com/en/cubism-sdk-manual/compatibility-with-cubism-5-3/>
- Cubism Web Samples GitHub: <https://github.com/Live2D/CubismWebSamples>
- Cubism Web Framework GitHub: <https://github.com/Live2D/CubismWebFramework>
- R.5 integration commit (loadShaders 等 r.5 必需 init): <https://github.com/Live2D/CubismWebSamples/commit/b1de66b0b1f1cb881d95fb6158622aeb6a2827bd>
- Live2D Community (issue search): <https://community.live2d.com/>

**Reading order for new debug session**：先这个 AGENTS.md → 上面 4 个 SDK upstream 文件（GitHub link 或本地 `.cache/` mirror）→ 我们的 `src/shell/renderer/live2d/carrier-visual-host.ts` → 再看 console 输出。**不要绕过 SDK sample 直接猜**。

### Model Package Integrity

当前 Live2D backend branch 从 `<model-pkg>/runtime/` 加载：
- 必须存在 `*.model3.json`（Cubism SDK 要求）
- 可选 `nimi/` 目录（按 agent-script-contract 扫描）
- 顶层 `.cmo3` / `.can3` source files 忽略（非 runtime 资源）

## Verification

```bash
# Spec layer
pnpm --filter @nimiplatform/avatar check:spec-consistency

# Code layer
pnpm --filter @nimiplatform/avatar typecheck
pnpm --filter @nimiplatform/avatar test
pnpm --filter @nimiplatform/avatar lint

# Rust layer
cd apps/avatar/src-tauri && cargo test
cd apps/avatar/src-tauri && cargo check
```

`lint` and `check:spec-consistency` are current supported commands for this app.
If either command stops resolving, repair the app-local tooling surface before
advertising the workflow as canonical.

## Retrieval Defaults

Start with: `.nimi/spec/avatar/kernel/tables/`, `.nimi/spec/avatar/kernel/`, `src/shell/renderer/nas/`, `src/shell/renderer/live2d/`, `src/shell/renderer/app-shell/`, `src-tauri/src/`.

Skip: `node_modules/`, `dist/`, `target/`, lockfiles.

## Code Conventions

- ULID for all new IDs (not UUID)
- ISO 8601 for date/time fields
- ESM imports use `.js` extension for `.ts` files
- Handler files are ES modules（`export default`）
- Live2D parameter ids 用 Cubism 官方命名（如 `ParamEyeBallX`）仅适用于当前 Live2D backend branch
- Mock data 用 `*.mock.json` 后缀区分于真实 fixture

---

## External Reference (Canonical Avatar Authority)

### airi 算法借鉴清单

`_external/airi/**` 是 reference-only。**0 行 import**（hard rule，
self-contained policy enforced by `pnpm check:apps-avatar-isolation`）；
仅借鉴算法 / 配比 / envelope 参数：

| Item | 来源 | 位置（apps/avatar） | License |
|---|---|---|---|
| MToon outline fallback policy | airi `composables/vrm/material-mtoon` | `vrm/vrm-mtoon-outline-policy.ts` | airi MIT；本 repo 重写实现 |
| VRM instance cache pattern | airi `composables/vrm/instance-cache` | `vrm/vrm-instance-cache.ts` | airi MIT；本 repo 重写实现 |
| Framing intent → camera/scale 算法 | airi `composables/vrm/framing` | `vrm/vrm-framing.ts` + `vrm/domain/vrm-framing-domain.ts` | airi MIT；本 repo 重写实现 |
| Hit-test render-target + alpha sample | airi `composables/render-target` + `composables/hit-test` | `vrm/vrm-render-target.ts` + `vrm/vrm-hit-region.ts` | airi MIT；本 repo 重写实现 |
| wLipSync envelope（ATTACK/RELEASE/CAP/SILENCE_VOL/IDLE_MS）| airi `composables/vrm/lip-sync` | `vrm/vrm-lipsync-driver.ts` + `live2d/live2d-lipsync-driver.ts` | airi MIT；常量集中表 |

### wlipsync 供应链兜底

- npm dep `wlipsync@^1.3.0`（MIT，单 maintainer `mrxz`）
- audio worklet processor + WASM blob inline 在包 entrypoint；vite bundling
  无需特殊 worker plugin
- 包失活时兜底：`apps/avatar/vendored/wlipsync/` 用作离线 fork（仅在
  原包不可用时启用；isolation gate 已为该路径开白名单）
- profile JSON `apps/avatar/assets/lip-sync/lip-sync-profile.json`
  fork-copy 自 airi `_external/airi/packages/model-driver-lipsync/src/shared/wlipsync/profile.json`，
  LICENSE source 标注

### License Compliance 表

| 包 | License | 用途 | 发布合规 |
|---|---|---|---|
| `@pixiv/three-vrm@^3.5.2` | MIT | VRM runtime | ship |
| `@pixiv/three-vrm-animation@^3.5.2` | MIT | `.vrma` loader | ship |
| `@pixiv/three-vrm-core@^3.5.2` | MIT | VRM core types | ship |
| `three@^0.183.2` | MIT | Three.js engine | ship |
| `@react-three/fiber@^9.5.0` | MIT | R3F renderer | ship |
| `wlipsync@^1.3.0` | MIT | wLipSync worklet | ship |
| `pixi.js@^8.19.0` | MIT | Nimi2D renderer foundation | ship |
| airi `_external/airi` | MIT | algorithm reference only; 0 lines imported | NOT shipped (reference-only) |

---

## App Boundary Import Policy

`apps/avatar/**` 是 Avatar product app；以下 import 路径**禁止**：

- `apps/desktop/**` / `apps/web/**` / `apps/install-gateway/**`
- `_external/**`（任何路径，runtime 引用禁止；airi 仅算法借鉴）

允许的 import：

- `@nimiplatform/kit/{ui,core,auth,telemetry}`（design system / core / telemetry）
- `@nimiplatform/kit/features/avatar/**`（admitted reusable Avatar surface；apps/avatar 只能消费，不能在 app 内重建第二套 shared owner）
- `@nimiplatform/sdk` / `@nimiplatform/sdk/runtime` /
  `@nimiplatform/sdk/realm` / `@nimiplatform/sdk/features/generation`
- `@pixiv/three-vrm` / `@pixiv/three-vrm-animation` / `@pixiv/three-vrm-core`
- `three` / `@react-three/fiber` / `@react-three/drei`（按已准入实现需要）/
  `@react-three/postprocessing`（按需）
- `pixi.js`
- `wlipsync`
- `react` / `react-dom` / `zustand`
- `@tauri-apps/api`

自动化 gate：`pnpm check:apps-avatar-isolation`（root + apps/avatar
package.json scripts；由 `scripts/check-apps-avatar-isolation.mjs` 执行）。

grep gate（相关修改必须运行）：

- `lipsync_frame_batch` 在 `apps/avatar/src/**` 必须 0 hits
- `fetchAudioBytes` / `fetchBytes` 在 `apps/avatar/src/**` 必须 0 hits
- `apps/desktop` / `_external/` 字符串在 `apps/avatar/src/**` 必须 0 hits

---

## VRM Backend Pitfalls

VRM 加载 / 运行时**强制**遵守的 10 项；不遵守 → 加载随机失败 / 模型隐形 /
context-lost 不可恢复 / Tauri webview 加载 hang / 嘴型双写冲突。

1. **rotateVRM0 → applyIdlePose → frustumCulled=false** 顺序强制
   （顺序错乱导致首帧 T-pose / 错误朝向 / 边缘剔除）
2. **createImageBitmap suspend** wrap 全部 `loader.loadAsync(.vrm/.vrma)`
   调用（Tauri webview WKWebView 偶发 hang；详 `vrm-backend-contract.md` §6.1）
3. **context-lost 1500ms 单次重试** + 二次失败立即 fail-close
   （多次重试 → GPU stale → 不可用时假装活着）
4. **scene.traverse: object.frustumCulled = false**（close-up framing 时部分
   网格被剔除）
5. **expressionManager.setValue 安全 wrap**（缺 preset → throw → catch + 跳过）
6. **viseme expression preset (aa/ih/ou/ee/oh) 由 lipsync driver 独占**；
   emote state 当 `lipsyncActive=true` 时 suppress viseme 写入（详
   `.nimi/spec/avatar/kernel/vrm-backend-contract.md`）
7. **wLipSyncNode lazy create per AudioContext 单次**（worklet register 是
   per-context；avatar 全局单 AudioContext，所以仅 createWLipSyncNode 一次）
8. **AnimationMixer crossFadeFrom** 切换 motion preset；不允许累积多 active
   clip（loop preset 替换前必须 stop）
9. **VRMUtils.rotateVRM0 幂等**（VRM 0.x → 1.0 朝向修正；调多次安全）
10. **scene 不在 useFrame 内修改 light intensity / position**（避免 stutter）

---

## Audio Pipeline

audio-pipeline 直接 consume `runtime.artifacts.readArtifactBytes`（S-RUNTIME-111）；
**不再 caller-注入 fetchBytes**。

### Synthetic mime fail-close

`audio_mime_type === SYNTHETIC_AUDIO_MIME_TYPE`
（`'application/x-nimi-synthetic-lipsync'`）时：

- audio-pipeline 不解码 / 不播放 / 不 attach lipsync sink
- `sink.silent()` 立即归零 mouth
- evidence emit `avatar.lipsync.silent { silent_reason: 'synthetic_audio' }`
- evidence emit `avatar.audio.playback.completed`（消费者状态机仍前进）
- log warn `synthetic_audio_no_playback_no_lipsync`

**显式语义**：synthetic mode = silent voice + silent mouth；不假装在动。

### 完整 fail-close 行为表

| 场景 | reason_code（emit `avatar.audio.playback.failed` / `.lipsync.silent`） |
|---|---|
| AudioContext 创建失败 / 无 user gesture | `no_audio_context` |
| `createWLipSyncNode` 失败（worklet/WASM 加载失败） | `wlipsync_init_failed`（emit `avatar.audio.pipeline.failed`） |
| `audio_mime_type === SYNTHETIC_AUDIO_MIME_TYPE` | `synthetic_audio` (silent) — see above |
| `audio_mime_type` 不以 `audio/` 开头且非 synthetic | `unsupported_mime` |
| `runtime.artifacts.readArtifactBytes` ARTIFACT_NOT_FOUND | `artifact_not_found` |
| `runtime.artifacts.readArtifactBytes` ARTIFACT_TOO_LARGE | `artifact_too_large` |
| `runtime.artifacts.readArtifactBytes` ARTIFACT_FORBIDDEN | `artifact_forbidden` |
| `runtime.artifacts.readArtifactBytes` ARTIFACT_MIME_MISMATCH | `artifact_mime_mismatch` |
| 其他 transport / RPC 错误 | `fetch_failed`（不重试；fail-close） |
| `decodeAudioData` 失败 | `decode_failed` |
| `playback_state='interrupted' \| 'canceled'` | （audioPipeline.stop；sink.silent via source.onended） |
| voice_playback_requested 缺 `audio_artifact_id` / `audio_mime_type` | event 忽略 |
| VRM model 缺全部 5 viseme expression preset | log warn at load；driver tick 安全 catch |
| Live2D model 缺 `ParamMouthOpenY` | fail-close at model load（关键参数） |
| wLipSyncNode message 异常 | log warn；当帧 snapshot=null（沿用上一帧 decay） |

**`music/` is NOT a valid MIME prefix** (RFC-6838); music artifacts use
`audio/*`. 不允许 audio-pipeline / artifact resolver 列 `music/` 作为
expectedMimePrefix.

### Reason code (S-RUNTIME-111 → SDK errors)

audio-pipeline catch SDK error 时使用 **`ReasonCode.ARTIFACT_INVALID_INPUT`**
（NOT `SDK_INVALID_INPUT`）作为 input validation 的 reason code。
import path: `import { ReasonCode } from '@nimiplatform/sdk/types'`.
