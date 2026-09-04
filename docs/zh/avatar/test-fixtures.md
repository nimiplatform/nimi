# 测试夹具

> 状态：现已可用。模拟夹具契约正在使用；模拟场景已在开发和 CI 中运行，提供夹具回归证据。

Avatar 里的测试夹具只为一个目的存在：**提供确定性的回归证据，同时绝不悄悄退回生产运行时路径**。模拟场景是明确的开发/测试夹具；它们不是真实的载体路径，也不能用来完成载体视觉证明。

## 夹具与真实运行时路径对比

| 方面 | 真实运行时路径 | 模拟夹具路径 |
| --- | --- | --- |
| 驱动 | `SdkDriver` 消费 `@nimiplatform/sdk` | `MockDriver` 注入场景事件 |
| 激活 | 默认 | 显式 `VITE_AVATAR_DRIVER=mock` |
| 用途 | 产品行为 | 受限的本地测试，夹具驱动的 UI / NAS 回归 |
| 证据价值 | 完成载体视觉验证 | 仅用于回归证据 |

工厂强制执行边界：

```ts
export function createDriver(): AgentDataDriver {
  if (import.meta.env.VITE_AVATAR_DRIVER === "mock") {
    return new MockDriver(loadScenario());
  }
  return new SdkDriver(sdkConfig);
}
```

应用层代码仅依赖于 `AgentDataDriver`。默认工厂返回 `SdkDriver`。模拟仅在明确请求时激活。

## 模块边界

```
src/shell/renderer/
├── mock/                      # 开发/测试夹具数据源
│   ├── MockDriver.ts          # 事件注入引擎
│   ├── scenario-loader.ts     # 加载 + 验证 *.mock.json
│   ├── scenarios/             # 场景文件
│   │   ├── default.mock.json
│   │   ├── basic-emotion.mock.json
│   │   └── …
│   └── index.ts
│
└── sdk/                       # 真实运行时/SDK 适配器
    ├── SdkDriver.ts           # @nimiplatform/sdk 消费包装器
    └── index.ts
```

`MockDriver` 和 `SdkDriver` 都实现了相同的 `AgentDataDriver` 接口。模拟模块绝不会泄露到 SDK 模块路径中。

## `AgentDataDriver` 接口

```ts
interface AgentDataDriver {
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: (event: AgentEvent) => void): Unsubscribe;
  onAgentDataChange(handler: (bundle: AgentDataBundle) => void): Unsubscribe;
  emit(event: { name: string; detail: Record<string, any> }): void;
}
```

两个驱动都遵循相同的结构，因此应用程序的其余部分无需知道哪个驱动被挂载。

## 场景文件格式

模拟场景 JSON 描述了要注入的事件序列以及应用程序所见的已准入的 bundle 上下文。场景结构由模拟夹具契约准入；加载器在注入前会根据 schema 进行验证。

| 字段 | 用途 |
| --- | --- |
| `bundle` | 初始 `AgentDataBundle` 快照 |
| `events` | 有序事件注入列表（`name`、`detail`、时序） |
| `triggers` | 基于触发器的注入点（例如，在 `avatar.user.click` 上） |
| `meta` | 场景 ID、描述、预期用途 |

支持基于时间的调度和基于触发器的调度。既无时间也无触发器的场景是一个静态 bundle 快照。

## 验证规则

| 规则 | 原因 |
| --- | --- |
| 加载时进行 Schema 验证 | 格式错误的场景会封闭失败；它不会静默空操作 |
| 强制执行必填字段 | 场景不能省略 bundle 快照 |
| 事件名称白名单 | 模拟不能注入已准入事件范围之外的事件 |
| 不会静默回退到实时数据 | 如果模拟失败，应用程序不会静默切换到 `SdkDriver` |

边界是严格的，因为一个模拟真实路径行为的夹具路径会产生虚假的通过证据。

## 读者场景：在开发环境中运行模拟场景

1.  **编写场景。** `scenarios/onboarding.mock.json` 声明了 bundle 快照以及一系列活动/情感事件。
2.  **激活。** 在 Avatar 应用程序工作区中运行 `VITE_AVATAR_DRIVER=mock pnpm dev`。
3.  **驱动工厂返回 `MockDriver`。** 加载场景；验证 schema；开始注入。
4.  **应用程序运行。** 具身化渲染场景；NAS 处理器在注入的事件上触发。
5.  **停止。** 停止开发服务器会停止驱动。没有状态泄露。

作者看到了他们的 NAS 处理器得到执行，而无需完整的运行时/SDK 栈实时运行。

## 读者场景：场景无法完成载体验证

1.  **贡献者提议：** “模拟场景产生了可见像素——这就是我们的视觉验收证据。”
2.  **拒绝。** 根据 [视觉验收](/avatar/visual-acceptance.md)，夹具/模拟路径仅作为回归证据。
3.  **拒绝理由。** “模拟夹具路径未执行真实的运行时/SDK/载体绘制链。”
4.  **重新规划。** 贡献者编写一个确定性的 Avatar 载体线束，用于执行真实路径。

模拟是受限的，因此审计边界保持诚实。

## 测试夹具不做什么

-   它们不会成为默认驱动。默认始终是 `SdkDriver`。
-   它们不会在错误时从 `SdkDriver` 静默回退到模拟。
-   它们不会完成载体视觉验收。
-   它们不会在已准入事件范围之外发明语义事件类型。
-   它们不会直接访问 Cubism / three-vrm。即使在模拟模式下，后端访问也通过映射进行。

## 边界总结

| 关注点 | 负责人 |
| --- | --- |
| 模拟激活规则 | 模拟夹具契约（`VITE_AVATAR_DRIVER=mock`） |
| 驱动接口 | `src/shell/renderer/driver/types.ts`（已准入） |
| 真实运行时适配器 | `src/shell/renderer/sdk/SdkDriver.ts` |
| 夹具事件注入 | `src/shell/renderer/mock/MockDriver.ts` |
| 场景文件 schema | 模拟夹具契约 |

## 来源依据

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)