# VRM Backend Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active `kind: 'vrm'` BackendBranch implementation authority
> **Sibling contracts**:
> - [Backend branch contract](backend-branch-contract.md)
> - [Live2D render contract](live2d-render-contract.md)
> - [Embodiment projection contract](embodiment-projection-contract.md)
> - [Carrier visual acceptance contract](carrier-visual-acceptance-contract.md)
> - [App shell contract](app-shell-contract.md)

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar **VRM backend branch** 的实现细节：模型加载
（GLTF + VRMLoaderPlugin）、MToon outline 策略、context-lost 恢复、Tauri
quirks、framing intent / nominal bounds 派生、expression preset 命名、
generated motion provider 接入、`.vrma` interchange support、audio consumer +
lipsync driver 接入。

VRM backend 实现 `BackendBranch` 抽象；carrier abstraction 公共契约见
[backend-branch-contract.md](backend-branch-contract.md)。

VRM library 版本 pin：`@pixiv/three-vrm@^3.5.2` /
`@pixiv/three-vrm-animation@^3.5.2` / `@pixiv/three-vrm-core@^3.5.2` /
`three@^0.183.2` / `@react-three/fiber@^9.5.0`。

---

## 1. Authority Scope

VRM backend 是 `apps/avatar` 内独立实现：

- 文件骨架：`apps/avatar/src/shell/renderer/vrm/**`
- 0 行 import 自 `@nimiplatform/kit/features/avatar/*` /
  `apps/desktop/**` / `_external/**`（self-contained policy；详
  `apps/avatar/AGENTS.md`）
- airi 算法借鉴：MToon outline / instance cache /
  framing / hit-test / lipsync envelope；**仅算法/配比/envelope，0 行 import**

---

## 2. Lifecycle

## K-NAV-VRM-001 Model Load

加载流程：

```
1. Manifest resolver 探测 model_path → kind: 'vrm'（详 design-08 §"ModelManifest"）
2. suspend createImageBitmap（Tauri webview quirk；详 §6.1）
3. GLTFLoader + VRMLoaderPlugin + VRMAnimationLoaderPlugin singleton
4. loader.loadAsync(vrmFile URL)
5. 检查 gltf.userData.vrm；缺失 → fail-close
6. VRMUtils.rotateVRM0(vrm)（VRM 0.x → 1.0 朝向修正；幂等）
7. applyIdlePose(vrm)（中性站姿；避免 T-pose 闪现）
8. scene.traverse: object.frustumCulled = false（避免 close-up 时模型部分剔除）
9. 计算 nominalBounds（详 §4）
10. 初始化 generated motion provider capability profile（详 §3）
11. emit avatar.model.load { model_kind: 'vrm', backend_meta: {...} }
12. resume createImageBitmap
```

`VRMUtils.rotateVRM0 → applyIdlePose → traverse frustumCulled=false` 顺序
**强制**；调换顺序导致首帧错误朝向 / T-pose 闪烁 / 边缘剔除。

### 2.2 Load Failure (Fail-Close)

| Failure | Action |
|---|---|
| `vrmFile` 不存在 / 不可读 | fail-close；emit `avatar.carrier.lifecycle.failed_closed { reason: 'load_failed' }` |
| GLTFLoader parse fail | fail-close；error UI 显示 "Invalid VRM file" |
| `gltf.userData.vrm` undefined | fail-close（不假装是空 VRM） |
| `MToonMaterialLoaderPlugin` register fail | fail-close |
| `applyIdlePose` 抛错（model 缺少 humanoid bone） | fail-close（VRM 必须有完整 humanoid skeleton） |

无静默 fallback；任何 failure 进 degraded surface。

## K-NAV-VRM-002 Context Lost & Restore

WebGL context lost 处理：

```
webglcontextlost → emit avatar.carrier.lifecycle.context_lost
                → 等待 1500ms（airi baseline）
                → 尝试 1 次 createRendererContext()
                  ├── success → emit avatar.carrier.lifecycle.context_restored
                  │            → 重新加载 VRM scene（reload textures + animations）
                  └── 二次 fail → emit avatar.carrier.lifecycle.failed_closed
                                → carrier 进 degraded surface
```

**强制单次重试**（airi 工业基线）；多次重试导致 GPU stale → 真正不可用时仍假装活着。

### 2.4 Shutdown

```
1. emit avatar.app.unmount
2. mixer.stopAllAction()
3. dispose VRM scene (geometry / textures / materials)
4. wLipSyncNode disconnect + close
5. AudioContext close（per-session 单例；avatar 主动 release）
6. Three.js renderer.dispose()
7. R3F <Canvas> unmount
```

---

## 3. Generated Motion Provider

## K-NAV-VRM-003 Runtime Support Path

APML auto-adapter runtime support is proved by generated `THREE.AnimationClip`
execution downstream of typed runtime projection, not by the presence of
physical `.vrma` files.

The VRM branch consumes:

- typed `runtime.agent.presentation.*` / `runtime.agent.state.*` projection
- Avatar route ids from `tables/generated-motion-routes.yaml`
- backend capability profiles conforming to
  `tables/backend-capability-profile.schema.yaml`
- mapping sidecars conforming to `tables/mapping-sidecar.schema.yaml`

Provider output is defined by
[`generated-motion-provider-contract.md`](generated-motion-provider-contract.md):
an executable `THREE.AnimationClip` or fail-closed evidence. Missing capability,
unsafe pose, low-confidence mapping, or an unknown route must fail closed; idle
fallback is not support for a non-idle route.

### 3.2 `.vrma` Interchange Loading

- 通过 `VRMAnimationLoaderPlugin` + `GLTFLoader.loadAsync(.vrma URL)` 加载
- `gltf.userData.vrmAnimations[0]` → `clipFromVRMAnimation(vrmAnimation, vrm)`
  转 `THREE.AnimationClip`
- `THREE.AnimationMixer` 持有当前 + 上一 clip；切换走 `mixer.crossFadeFrom`
- 每帧 `mixer.update(delta)` + `vrm.update(delta)` 同节拍

This path is admitted only for interchange and authoring evidence. It
must not be required for APML auto-adapter runtime support.

## K-NAV-VRM-004 Interchange Preset Registry

Interchange registry见 `tables/vrm-motion-presets.yaml`。每 entry 必须有：

- `id`: stable ontology-anchored id
- `file`: `.vrma` 文件名（相对 `apps/avatar/assets/vrm-motion-presets/`）
- `loop`: bool
- `license`: SPDX id 或 `internal`
- `source`: URL 或 `internal` source description（不允许占位值）

Interchange loading strategy:

- `apps/avatar/assets/vrm-motion-presets/<id>.vrma` 是默认资产
- `model_path/motions/<id>.vrma` 是 per-model override（探测存在则优先）
- this registry must not be constructed or loaded on the APML auto-adapter
  runtime support path

### 3.4 Per-Model Override For Interchange

manifest 探测 `model_path/motions/` 子目录（详 design-08）：

- 存在 → 注册 override；同 id 时覆盖 builtin
- 不存在 → 仅用 builtin
- override resolution is interchange-only; generated provider failure must not
  fall back to per-model `.vrma` playback

### 3.5 Generated Runtime Play Semantics

```ts
generatedMotionRuntime.play({
  routeId: 'nod_yes',
  fade: 0.2,        // crossfade 秒数
  loop: false,
  intensity: 1,     // 0..1 影响 crossfade 速度上界
});
```

约束：

- 引用未在 generated motion route registry admit 的 `routeId` → fail-close
  （log warn，不假装在动）
- missing generated provider / missing capability profile / unsafe generated
  pose / low-confidence mapping → fail-close, no placeholder success
- `loop: true` 的 generated clip 在新 play 调用时必须显式被 stop（不允许累积多 loop clip）
- APML auto-adapter support must not depend on this registry; use generated
  provider route support instead.

---

## 4. Nominal Bounds

## K-NAV-VRM-005 Derivation

VRM `BackendNominalBounds.width/height` 派生顺序：

```
1. scene bbox 计算（new THREE.Box3().setFromObject(vrm.scene)）
2. apply framingIntent（默认 'bottom-companion'，见 §4.2）
3. clamp 到 vrm-backend default fallback (360 × 720)
4. bodyCenterX / bodyCenterY 来自 vrm.humanoid 中心 bone（HipsBone）的
   normalized projection
```

fallback 360 × 720 在 scene bbox 不可计算时（理论上不发生）使用。

### 4.2 Framing Intent

```ts
type VrmFramingIntent =
  | 'full-body'         // 全身可见，camera 远；适合 idle / motion preview
  | 'bottom-companion'  // 下半身切角，camera 较近，bodyCenterY 偏上；avatar 默认
  | 'head-shoulders'    // 半身肖像，camera 最近；speaking 强调
  ;
```

avatar 默认 `bottom-companion`，aspect 0.45（高瘦窗口）。framing intent
可由 NAS handler 通过 `BackendProjection.applyMotion` extension hint 传递
（implementation may consume the namespace only after this contract admits it）。

---

## 5. Expression System

## K-NAV-VRM-006 Preset Names

VRM expression preset 标准命名：

- **Viseme**：`aa`、`ih`、`ou`、`ee`、`oh`（lipsync driver 写）
- **Emotion**：`happy`、`sad`、`angry`、`relaxed`、`surprised`、`neutral`
- **Extended**：可选；model 自定义 preset name 由 emote-states.yaml 引用时
  在 model 加载时探测，缺则 skip + log warn（partial degrade）

### 5.2 Expression Manager API

通过 `vrm.expressionManager.setValue(name, weight)` 写入；统一在 useFrame
末端 flush。

约束：

- viseme preset 写入由 lipsync driver 独占（`vrm-lipsync-driver.ts`）
- emotion preset 写入由 emote state 独占（`vrm-emote-state.ts`）
- 两者**互斥**：lipsync active 时 emote state 不写 viseme

---

## 6. Tauri WebView Quirks

## K-NAV-VRM-007 createImageBitmap Suspend

Tauri webview（macOS WKWebView）在 GLTF texture 加载阶段触发
`createImageBitmap` 时偶发 hang。VRM loader 必须在 `loadAsync` 调用
**之前** suspend 全局 `createImageBitmap`，之后 restore：

```ts
const restore = suspendCreateImageBitmapForTauriVrmLoad();
try {
  const gltf = await loader.loadAsync(url);
  // ...
} finally {
  restore();
}
```

实现细节：把 `window.createImageBitmap` 临时替换为 throw（强制 GLTFLoader
走 `<img>` fallback 路径）；`finally` 恢复原引用。

### 6.2 secure context

Tauri webview 默认是 secure context（`tauri://localhost`），满足 audio
worklet（wLipSync）+ WebGL2 + offscreen canvas 要求。

---

## 7. MToon Outline Policy

## K-NAV-VRM-008 Outline Algorithm

VRM 标准 MToon material 支持 outline（描边）。avatar 使用 airi 工业级
outline fallback 算法：

- 默认尝试 MToonMaterialLoaderPlugin outline
- outline 不可渲染（如 GPU 不支持几何 shader fallback）→ skip outline，
  渲染 base material
- 失败不算 fail-close（outline 是装饰，缺也能 ship）

### 7.2 Plugin Wiring

```ts
loader.register((parser) => new VRMLoaderPlugin(parser, {
  mtoonMaterialPlugin: createMToonMaterialLoaderPlugin(parser),
  // airi AiriMToonMaterialLoaderPlugin 算法 ref；apps/avatar 内独立写
}));
```

---

## 8. Audio Consumer & Lipsync Driver

VRM backend 提供 `BackendAudioConsumer` 实现：

- `vrm/vrm-audio-consumer.ts`：内部 lazy create wLipSyncNode；attach 到当前
  AudioBufferSource；snapshot 暴露 weights + volume
- `vrm/vrm-lipsync-driver.ts`：6-dim weights → `aa/ih/ou/ee/oh` 5 viseme
  preset；envelope + winner+runner blend

约束：

- `attachAudioSource` 是 async（包内首次 worklet/WASM 加载）
- silent 路径必须把 5 个 viseme expression preset weight 全部设 0
- VRM model 缺全部 5 个 viseme preset → log warn at load；driver tick 内
  `setValue` 安全（preset 缺失 throw → catch 后跳过）

---

## 9. Scene Hierarchy

R3F `<Canvas>` 内 scene 结构：

```
<Canvas>
  <ambientLight intensity={0.6} />
  <directionalLight position={[1, 1, 1]} intensity={0.8} />
  <primitive object={vrm.scene} />     ← VRM model
  <camera frustumCulled={false} />
</Canvas>
```

约束：

- `frustumCulled=false` 应用于 `<Canvas>` camera 与 scene.traverse 整树
- 不允许在 useFrame 内修改 light intensity / position（避免 stutter）
- postprocess 极轻量；新增 pass 必须先由本 contract 或子表承认

---

## 10. Hit Region

VRM hit region 实现：

- `vrm/vrm-hit-region.ts`：alpha-mask via offscreen render-target
  + bbox snapshot（详 `app-shell-contract.md` §"Hit Region 双层结构"）
- `vrm/vrm-render-target.ts`：airi render-target 算法 ref；offscreen FBO +
  readPixels（1/2 res，per-frame query budget 1ms）

bbox 计算：从 scene bbox 投影到 normalized client coord；snapshot 100ms
throttled 上报到 carrier（详 design-07）。

---

## 11. Drift Check

- VRM 文件加载顺序违反 `rotateVRM0 → applyIdlePose → frustumCulled=false`
  → fail-close（unit test 强制断言）
- `BackendBranch.kind === 'vrm'` 时不允许暴露 `live2dExtension` 字段
  （discriminated union typecheck 强制）
- generated motion route lacks capability profile support → fail-close
- `vrm-motion-presets.yaml` 引用 `.vrma` 文件不存在 → interchange validator
  fail; this is not APML runtime support proof
- `model_path/motions/<id>.vrma` 同名 override 必须与 builtin 同 ontology
  semantics（不允许语义偏移；human review at admit）
- `createImageBitmap` 不被 suspend 直接调用 `loader.loadAsync` → typecheck
  pass 但 e2e Tauri 加载随机 hang（必须 lint 强制 wrap）

---

## 12. Evolution

- 新 VRM expression preset 命名 → minor bump + 同步 `vrm-emote-states.yaml`
- 新 generated motion route → update `generated-motion-routes.yaml`,
  capability profile schema expectations, and provider tests in the same packet
- 新 framing intent → minor bump
- 改 context-lost recovery 策略（如多次重试）→ major bump（与 fail-close
  posture 强相关）
- VRM 1.x → 2.x library 升级 → 评估 `rotateVRMx` 等 API breakage；可能
  major bump
