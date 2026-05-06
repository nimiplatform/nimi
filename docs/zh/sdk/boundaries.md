# SDK 边界

SDK 边界存在的目的是让 App 集成既稳定又诚实。它不只是个便利包。它是公开 App 面行为与所有者域私有实现之间的那条线。

支撑这页的 kernel 规则在 `S-BOUNDARY-*` 与 `S-SURFACE-*` 下。

## 边界规则

- App 应该用 SDK 的公开 export，不去走 Runtime 或 Realm 的私有路径。
- SDK 表面不应静默重新定义 Runtime、Realm、桌面端、Cognition 的真相。
- 包局部权威只在 SDK kernel 显式准入时才允许。
- 一份可读文档不足以创立新的 SDK 承诺。承诺要先准入；页是后写。

## 边界违反为什么贵

边界违反在 AI 产品里贵恰恰是因为它一开始看起来人畜无害。直接 import 一下、写个本地 helper、临时绕一条路 — 哪个都不会立刻坏什么。

但它们会随着时间变成结构问题。App 的行为开始耦合到它从未承诺为自己面的内部实现。App 形成对 Runtime 或 Realm 的本地预期，可能跟合同对不上。Agent、App、文档因此互相漂移，因为各自锚在略不一样的现实上。

## 阅读场景：「就一个 helper」反模式

某 App 开发者需要一个小的格式化逻辑，恰好 runtime 包里已经有一个。最方便的动作是直接 import 那个 helper。SDK 边界说不行。

理由是：

1. Runtime 包的内部没有面对外部的准入合同。
2. 从那里 import 静默地 import 了一个不稳定的形状。
3. 那个 helper 可能在下一次 runtime 改动里消失或改形状。
4. 如果那 helper 真普遍有用，正确做法是把它准入为某个 SDK 表面的一部分，不是吸纳一个私有 import。

拒绝那个 import 不是较真。是它让 App 的面保持稳定与可预期。

## 阅读场景：试图绕开 hook 的 mod

某个桌面端 mod 出于性能原因想直接调 Runtime，绕过桌面端的 hook 能力层。这是同一类边界违反的另一种形状。

- Mod 通过宿主注入的 mod 表面消费能力，不通过任意 runtime import。
- 桌面端 hook 合同治理 mod 在用户面附近能干什么。
- 直接调 Runtime 跳过了 mod 本应继承的能力白名单与审计姿态。

性能诉求是真的。正确满足方式是扩展 hook 表面或准入新的 SDK 模式，不是从边界溜过去。

## 边界里有什么、外面有什么

边界**里**住着 App、mod、外部集成可以当作稳定承诺的东西：

- 公开 SDK 子路径与 export；
- 文档化的 runtime 方法、世界组合基础协议、realm facade 读、scope 暴露、mod hook；
- `sdk/types` 下的类型化共享构件。

边界**外**住着所有为 runtime 实现存在的东西：

- 私有 runtime 包、内部 client 代码、transport 级胶水代码；
- 私有 realm 内部；
- 桌面端 / Cognition 内部。

边界本身记在 `.nimi/spec/sdk/kernel/boundary-contract.md` 与 import boundaries 表里。

## 来源

- [`.nimi/spec/sdk/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/boundary-contract.md)
- [`.nimi/spec/sdk/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/surface-contract.md)
- [`.nimi/spec/sdk/kernel/tables/import-boundaries.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/import-boundaries.yaml)
- [`.nimi/spec/platform/kernel/app-slice-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/app-slice-admission-contract.md)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
