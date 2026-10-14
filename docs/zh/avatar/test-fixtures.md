# Avatar 开发夹具

测试夹具为本地回归提供可重复的输入流，无需连接真实的 Runtime 会话。当显式配置 `VITE_AVATAR_DRIVER=mock` 时，Driver Factory 会实例化 `MockDriver`；默认路径则为 `SdkDriver`，且依赖真实的 SDK 引导输入。

夹具可用于验证数据解析、调度以及本地映射逻辑。若要正确显示开发模型，fixture 配置还必须提供有效的模型 manifest；仅有事件 JSON 并不保证能渲染出模型画面。此外，开发预览会保持 `fixture_not_verified` 状态，不能直接用于产品验收签发。

## 当前 Driver 接口

Avatar 维护者应通过 `AgentDataDriver` 的既有公开方法接入：`start`、`stop`、`getBundle`、`onEvent`、`onBundleChange`、`onStatusChange` 以及 `emit`。其中 `emitCancelable` 为可选方法，`kind` 与 `status` 则是只读状态字段。

通过 `onBundleChange` 监听 bundle 更新（注意不存在 `onAgentDataChange`）。Factory 在创建 mock 驱动时需要传入 `scenarioJson`（可同时指定 `scenarioSource`）；创建 SDK 驱动时则需要 `SdkDriverOptions`，不支持无参调用。

## Scenario 格式

| 字段 | 要求 |
| --- | --- |
| `scenario_id` | 非空字符串；加载已知 fixture 文件时须与文件名保持一致 |
| `version` | 字符串 "1" |
| `description` | 场景描述字符串 |
| `duration_ms` | 可省略或设为 null；若提供数值必须为有限正数；当 `loop=true` 时必须提供该数值 |
| `loop` | 必填布尔值 |
| `agent_bootstrap` | 包含初始 fixture 虚拟世界、用户、locale、姿态、状态文本与执行状态 |
| `events` | 必填数组；静态场景可填 `[]` |
| `triggers` | 可选交互触发列表 |

格式中不包含 `bundle/meta` 结构。`time` 事件使用 `kind=time`、`at_ms`、`type` 与 `detail`；`after` 事件使用 `kind=after`、`after_event_id`、`delay_ms`、`type` 与 `detail`，且引用的 `event_id` 必须已在场景中声明。

Fixture 活动固定发送 `avatar.fixture.presentation.activity_requested` 并将 source 设为 `mock`，切勿将模拟输入混淆或伪装为经 Runtime 授权的真实事件。

## 静态输入样例

文件命名为 `static-preview.mock.json`：

```json
{
  "scenario_id": "static-preview",
  "version": "1",
  "description": "Static development preview",
  "duration_ms": null,
  "loop": false,
  "agent_bootstrap": {
    "active_world_id": "fixture-world",
    "active_user_id": "fixture-user",
    "locale": "en-US",
    "initial_posture": {
      "posture_class": "baseline_observer",
      "action_family": "observe",
      "interrupt_mode": "welcome",
      "transition_reason": "scenario_start",
      "truth_basis_ids": []
    },
    "initial_status_text": "Development preview",
    "initial_execution_state": "IDLE"
  },
  "events": []
}
```

上述身份标识字段仅在 fixture 内生效，不会建立真实的账号、App 会话或上下文连续性。调试时可先通过现有的 `loadScenarioFromJson` 或 `parseScenario` 校验格式；完整参考范例请参阅 `default.mock.json`。模型实际呈现与实时产品链路仍需分别进行独立验证。

## 相关文档

- [本地诊断与就绪](/zh/avatar/instance-lifecycle)
- [视觉呈现验收](/zh/avatar/visual-acceptance)

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/driver/types.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/driver/types.ts)
- [`apps/avatar/src/shell/renderer/driver/factory.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/driver/factory.ts)
- [`apps/avatar/src/shell/renderer/mock/scenario-types.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/mock/scenario-types.ts)
- [`apps/avatar/src/shell/renderer/mock/scenario-loader.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/mock/scenario-loader.ts)
- [`apps/avatar/src/shell/renderer/mock/scenarios/default.mock.json`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/mock/scenarios/default.mock.json)
- [`apps/avatar/src/shell/renderer/app-shell/app-bootstrap.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/app-bootstrap.ts)
