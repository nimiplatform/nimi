# VRM 动作编写

Avatar 里的 VRM 动作有两条不同路径：

- 运行时动作证明来自生成式动作提供器、能力配置、映射 sidecar 和已准入的后端路由。
- `.vrma` 文件是编写和交换用的动作资产。它可以被当作动作 preset 加载，但文件存在本身不证明一个包支持运行时驱动的动作。

这个区别对作者很重要。`.vrma` 适合承载可移植的骨骼动画 preset。它不能替代运行时提供器路径，后者负责把 Agent 活动转换成实时后端输出。

## 什么时候编写 `.vrma`

以下场景适合使用 `.vrma`：

- 添加 `apps/avatar/assets/vrm-motion-presets/` 下的内置交换 preset；
- 为某个模型提供 `<model_path>/motions/<preset_id>.vrma` 覆盖；
- 制作能被 `@pixiv/three-vrm-animation` 加载的参考动画；
- 编写可循环的 idle、呼吸、短手势动作，供检查或交换使用。

不要用 `.vrma` 声明 APML 或运行时活动支持。运行时支持要通过生成式动作提供器证据证明。

## 工具

| 工具 | 用途 |
| --- | --- |
| Blender 4.x | 编写骨骼动画。 |
| UniVRM Blender add-on 2.x | 导入 `.vrm` 并导出 `.vrma`。 |
| 参考 VRM 文件 | 提供 humanoid 骨架目标。 |
| `@pixiv/three-vrm-animation` | Avatar 使用的运行时加载器。 |

`@pixiv/three-vrm-animation` 不是 Blender 插件。作者在 Blender 中制作动画，Avatar 在运行时加载导出的 `.vrma`，它本质上是带 `VRMC_vrm_animation` 扩展的 glTF binary。

## 内置 Preset 注册表

当前内置交换注册表只准入一个物理 preset：

| Preset id | 文件 | 是否循环 | 用途 |
| --- | --- | --- | --- |
| `idle_subtle` | `idle_subtle.vrma` | 是 | 轻微 idle 动作基线。 |

`listen_lean`、`nod_yes`、`shake_no`、`greet_wave` 等其它动作 route id 是生成式动作路由，不要求存在内置 `.vrma` 文件。

## Blender 流程

1. **导入参考 VRM。** 使用 UniVRM 的 VRM 导入路径，并确认场景里出现 humanoid armature。
2. **创建 Action。** 在 Animation workspace 打开 Action Editor，创建一个以 preset id 命名的 action。
3. **只给 humanoid 骨骼打关键帧。** UniVRM 按 humanoid 骨架导出动画。除非目标使用明确支持，否则不要依赖非 humanoid 辅助骨骼。
4. **避免根部漂移。** Hips 位移尽量少。呼吸、倾身、点头、注视优先用轻微旋转表达。
5. **精确闭环。** 循环 clip 的第一帧和最后一帧在每条已动画化通道上必须一致。
6. **导出 `.vrma`。** 使用 UniVRM 的 VRM Animation 导出路径。文件名必须与注册表 `file` 字段一致。
7. **放置资产。** 内置 preset 放在 `apps/avatar/assets/vrm-motion-presets/`。模型覆盖放在 `<model_path>/motions/`。
8. **验证加载。** 资产必须能通过 `loadVrmAnimation` 加载，并通过 `clipFromVRMAnimation` 重定向。

## 循环闭合

循环 preset 在导出前应能在 Blender 中平滑回绕。如果时间线回到开头时姿态跳动：

1. 打开 Graph Editor。
2. 找到首尾帧不一致的通道。
3. 把第一帧的值复制到最后一帧。
4. 重新导出并测试。

桌面伴随形象在透明窗口里运行，用户会把注意力集中在身体上，因此很小的漂移也会显眼。

## 注册表和许可要求

每个内置 `.vrma` 注册项都需要：

- `apps/avatar/assets/vrm-motion-presets/` 下真实存在的文件；
- 稳定的 preset id；
- 具体的 license 和 source 元数据；
- 如果资产来自第三方或基于第三方作品，需要记录 attribution；
- 测试或手动证据，证明文件能通过 Avatar 的 VRM animation loader 加载。

注册表里不能使用 `TBD`、`candidate` 这类占位值。

## 模型级覆盖

VRM 包可以包含：

```text
<model_path>/motions/<preset_id>.vrma
```

`preset_id` 必须已经存在于准入注册表里。未知覆盖 id 会被注册表加载器拒绝。这样每个模型的覆盖仍然对齐 Avatar 的动作命名，而不是各自发明不兼容的本地名字。

## 场景：添加新的 Idle 变体

作者希望给某个 VRM 角色提供更轻柔的 idle 动作。

1. 作者基于角色的 humanoid 骨架制作 `idle_subtle`。
2. 导出 `idle_subtle.vrma`。
3. 放到 `<model_path>/motions/idle_subtle.vrma`。
4. Avatar 检测到模型级覆盖，并在交换播放时使用它。
5. 运行时活动支持仍然来自生成式动作提供器。这个覆盖文件本身不会变成运行时证明。

## 来源依据

- [`.nimi/spec/avatar/kernel/vrm-backend-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/vrm-backend-contract.md)
- [`.nimi/spec/avatar/kernel/generated-motion-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/generated-motion-provider-contract.md)
- [`.nimi/spec/avatar/kernel/tables/vrm-motion-presets.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/tables/vrm-motion-presets.yaml)
- [`.nimi/spec/avatar/kernel/tables/generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/tables/generated-motion-routes.yaml)
- [`apps/avatar/assets/vrm-motion-presets/THIRD_PARTY_LICENSES.md`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/assets/vrm-motion-presets/THIRD_PARTY_LICENSES.md)
- [`apps/avatar/src/shell/renderer/vrm/vrm-motion-preset-registry.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-motion-preset-registry.ts)
