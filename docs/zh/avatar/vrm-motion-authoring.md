# VRMA 交换动画

`.vrma` 文件主要用于动画创作、资产交换与离线检查。在当前 Avatar 产品运行环境中，活动与待机动作均由生成动作（Generated Motion）运行时驱动，系统不会通过扫描模型 `motions` 目录来自动替换待机动作。

## 创作与交换

制作与目标 VRM 人形骨骼相匹配的动画，并导出为当前加载器支持的 VRM Animation 格式。务必仔细核对骨骼映射、表情绑定、循环衔接以及重定向效果；具体导出参数请参阅相关工具的官方说明。

仓库内置的 VRMA preset registry 属于独立的资产交换（interchange）路径。它会加载 preset 配置表，并支持由调用方显式传入 `perModelOverrides` 列表；命中已有 preset ID 时会覆盖原条目，但传入未知的 ID 并不会直接注册为新的产品路由。

## 模型特定的交换片段

1. 针对目标骨骼创作并导出一个动画片段。
2. 在集成了 interchange registry 的工具中，为已知的 preset ID 显式提供该片段的资源引用。
3. 调用 registry 的 `loadAll` 方法，传入目标 VRM 和 `perModelOverrides`，检查资产加载与重定向结果。
4. 在该工具的实际播放流程中核验循环衔接与目标姿态。

仅将 `idle_subtle.vrma` 放入模型目录，并不能改变产品中的待机表现。正式的产品路由支持完全由生成动作目录、模型能力配置文件以及安全约束共同判定，文件在目录中就位本身并不能作为功能支持的依据。

## 当前产品动作

如需接入或验证产品中的 `nod_yes`、`greet_wave` 或 `idle_subtle` 等具体路由，请走当前的[生成动作与 Sidecar](/zh/avatar/generated-motion-provider) 路径，并在真实的 Avatar 窗口中核对运行效果。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-vrm-motion-presets.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-vrm-motion-presets.yaml)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
- [`apps/avatar/src/shell/renderer/vrm/vrm-motion-preset-registry.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-motion-preset-registry.ts)
- [`apps/avatar/src/shell/renderer/vrm/vrm-backend.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-backend.tsx)
- [`apps/avatar/src/shell/renderer/vrm/vrm-projection-adapter.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-projection-adapter.ts)
