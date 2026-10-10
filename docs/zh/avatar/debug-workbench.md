# Avatar 后端诊断

后端本地评估归 Avatar。诊断结果可以说明后端是否加载、路由是否支持、语音与口型是否按输入呈现，但不会创建 Runtime probe 身份、专属 Runtime 存储、公共 App 权限或 LocalAgent 成功。

## 结果形状

Avatar 结果必须包含 `diagnostic_session_id`、backend kind、probe kind、`observed_at` 与 evidence。每项 evidence 包含 `evidence_id`、`evidence_kind`、`status` 和 `source`。状态只有 `passed`、`failed`、`unsupported`、`invalid`。

可附带不透明的公共 Runtime correlation 引用，用于关联观察。结果不含原始 Agent/账号身份、Runtime 专属存储引用、Provider/模型细节、包路径、提示词、推理内容或公共操作权限。

## 证据类别

- `package_descriptor_resolved`
- `backend_loaded`
- `capability_profile_validated`
- `route_support_checked`
- `generated_motion_checked`
- `emotion_expression_checked`
- `speech_lipsync_checked`
- `carrier_diagnostics_checked`

可选 payload 只包含有界强类型事实或不透明已授权引用，不能重建 Runtime 上下文，也不产生持久执行重放服务。

## 检查动作路由

把已授权强类型呈现输入与选中的 Avatar route、后端、验证过的 capability profile 及可选 mapping sidecar 一起评估。确定性 provider 返回该后端可执行输出，或确切的强类型失败。不支持就保持不支持；找到 `.vrma` 文件、截图、预览或 fixture 通过，都不能证明真实 Runtime 到载体的完整路径。

真实产品结果遵循[视觉验收](/zh/avatar/visual-acceptance)和[载体验收](/zh/avatar/carrier-acceptance)。本地诊断与 fixture 测试只证明它们各自覆盖的事实。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
- [`config/avatar-backend-capability-profile.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-backend-capability-profile.schema.yaml)
