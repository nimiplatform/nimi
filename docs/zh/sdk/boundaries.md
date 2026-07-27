# SDK 边界

SDK 边界存在的目的，是让 App 接入既稳定又诚实。SDK 不只是一个便利包，它是公开 App 行为与各权威域私有实现之间的那条线。

本页背后的内核规则放在 `S-BOUNDARY-*` 与 `S-SURFACE-*`。

## 边界规则

- App 应使用 SDK 的公开导出，不应使用 Runtime 或 Realm 的私有路径。
- SDK surface 不应静默重定义 Runtime、Realm、桌面端、Cognition 的真值。
- 包内权威只在 SDK 内核明确准入时才被允许。
- 一份可读的文档页本身不能创造一个新的 SDK 承诺。承诺先准入；页面是转换后的视图。

## 为什么边界违例代价高

边界违例之所以代价高，正因为它一开始看上去无害。一次直接导入、一个本地 helper、一段临时路由，单看都没问题。

时间一长，这些违例会变成结构性的。App 行为开始耦合到它从未承认为自身 surface 一部分的内部细节。App 形成了一种关于 Runtime 或 Realm 行为的本地预期，这种预期可能并不匹配契约。Agent、App、文档之间因此漂离，因为各自的锚点是不一样的现实。

## 场景："就引一个 helper"反模式

假设某个 App 开发者需要一小段格式化逻辑，而 runtime 包里早就有了。最便利的做法是直接导入这个 helper。SDK 边界的回答是：不行。

理由：

1. runtime 包的内部没有任何对外准入的契约。
2. 从那里导入，等于静默引入一个不稳定的形状。
3. 这个 helper 在下一次 runtime 变更里可能消失或改形。
4. 如果这个 helper 普遍有用，正确做法是把它准入为某个 SDK surface 的一部分，而不是吸收一次私有导入。

拒绝这次导入不是教条。这是 App surface 保持稳定与可预测的方式。

## 场景：想绕过 SDK 的 App

假设某个 App 出于性能考虑，想绕过 SDK 投影直接调用 Runtime。这是同一种边界违例的另一种形态。

- App 通过 SDK 公开方法使用 Runtime，不通过任意 runtime 导入。
- Runtime-owned 行为必须留在 Runtime 契约与 SDK 投影之后。
- 直接调用 Runtime 内部会跳过 App 应继承的稳定错误、传输与权威边界。

性能诉求可能是真的。正确回应是准入新的 SDK 模式，而不是从边界下钻过去。

## 边界内与边界外

边界内是 App 与外部接入可以倚为稳定承诺的内容：

- 公开的 SDK 子路径与导出；
- 已记录的 runtime 方法、世界组合基础协议、Realm 门面读取、作用域转换；
- `@nimiplatform/sdk/types` 下的强类型共享构件。

边界外是出于 runtime 实现原因而存在的内容：

- 私有 runtime 包、内部 client 代码、传输层胶水；
- 私有 Realm 内部；
- 桌面端或 Cognition 的内部细节。

边界本身记录在 `.nimi/spec/sdks/client-core.authority.yaml` 与 TypeScript target export map 中。

## 来源依据

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`config/sdks-typescript-target-export-map.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/sdks-typescript-target-export-map.yaml)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
