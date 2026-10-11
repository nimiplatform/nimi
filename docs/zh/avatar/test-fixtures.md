# Avatar 开发夹具

夹具为本地回归提供可重复的输入，不调用真实 Runtime 会话。显式选择 `VITE_AVATAR_DRIVER=mock` 后，当前 driver factory 使用 MockDriver；默认路径为 SdkDriver，并需要真实 SDK bootstrap 输入。

夹具可以验证解析、调度和本地映射。显示开发模型还需要 fixture 配置提供有效的模型 manifest；仅有事件 JSON，不保证出现模型画面。开发预览保持 fixture_not_verified，不能用于关闭产品验收。

## 当前 Driver 接口

Avatar 维护者使用 AgentDataDriver 的真实方法：start、stop、getBundle、onEvent、onBundleChange、onStatusChange 和 emit。emitCancelable 为可选方法。kind 与 status 为只读状态。

`onBundleChange` 通知 bundle 更新，不存在 onAgentDataChange。factory 的 mock 输入需要 scenarioJson，可同时提供 scenarioSource；sdk 输入需要 SdkDriverOptions，不是无参数创建。

## Scenario 格式

| 字段 | 要求 |
| --- | --- |
| `scenario_id` | 非空字符串，读取已知 fixture 文件时须匹配其文件名 |
| `version` | 字符串 "1" |
| `description` | 字符串 |
| `duration_ms` | 可省略或为 null；提供数值时须为正，loop=true 时必须有限 |
| `loop` | 必填布尔值 |
| `agent_bootstrap` | 初始 fixture 世界、用户、locale、姿态、状态文字与执行状态 |
| `events` | 必填数组，静态场景写 [] |
| `triggers` | 可选交互触发列表 |

没有 bundle/meta 结构。time 事件使用 kind=time、at_ms、type、detail；after 事件使用 kind=after、after_event_id、delay_ms、type、detail，引用的 event_id 必须存在。

Fixture 活动使用 `avatar.fixture.presentation.activity_requested` 与 source=mock，不把模拟输入冒充 Runtime 授权事件。

## 静态输入样例

文件名为 static-preview.mock.json：

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

这些身份字段仅用于 fixture，不建立真实账号、App 会话或对话连续性。可先用当前 loadScenarioFromJson/parseScenario 校验格式；真实参考输入见 default.mock.json。模型呈现和实时产品路径还需分别验证。

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
