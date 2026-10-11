# VRMA 交换动画

.vrma 文件用于动画创作、交换与离线检查。当前 Avatar 产品活动和待机通过生成动作运行时执行，不会扫描模型 motions 目录来自动覆盖 idle。

## 创作与交换

准备与目标 VRM 人形骨骼匹配的动画，导出为当前加载器支持的 VRM Animation 格式。验证骨骼、表情、循环边界和重定向结果，具体导出器操作以所用工具的文档为准。

仓库的 VRMA preset registry 是独立的 interchange 路径。它根据 preset 表加载文件，并可接受调用方显式传入的 perModelOverrides 列表；匹配的 preset ID 覆盖原项，未知 ID 不会变成新的产品路由。

## 模型特定的交换片段

1. 创作并导出一个符合目标骨骼的片段。
2. 在使用 interchange registry 的工具中，为已知 preset ID 显式提供该片段的资源引用。
3. 调用 registry 的 loadAll，传入目标 VRM 和 perModelOverrides，检查加载与重定向结果。
4. 在该交换工具的实际播放路径验证循环和目标姿态。

仅把 idle_subtle.vrma 放入模型目录，不会改变当前产品待机。正式活动支持仍由生成动作目录、模型能力配置和安全限制决定，不能用文件存在作为支持证明。

## 当前产品动作

需要检查产品中的 nod_yes、greet_wave 或 idle_subtle 等路由时，使用[生成动作与 Sidecar](/zh/avatar/generated-motion-provider)的当前路径，并在真实 Avatar 窗口验证所需结果。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-vrm-motion-presets.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-vrm-motion-presets.yaml)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
- [`apps/avatar/src/shell/renderer/vrm/vrm-motion-preset-registry.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-motion-preset-registry.ts)
- [`apps/avatar/src/shell/renderer/vrm/vrm-backend.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-backend.tsx)
- [`apps/avatar/src/shell/renderer/vrm/vrm-projection-adapter.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-projection-adapter.ts)
