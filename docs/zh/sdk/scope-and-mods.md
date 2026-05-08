# 作用域与 Mod

`@nimiplatform/sdk/scope` 把授权与目录生命周期改写给 App。`@nimiplatform/sdk/mod` 是宿主注入的 mod 门面，mod 通过它消费能力。两者拆为不同子路径，因为它们解决不同问题；都受 SDK 边界约束。

## `sdk/scope` — 授权改写

scope 子路径把授权状态改写为强类型 App surface。

| 关注点 | scope 覆盖范围 |
| --- | --- |
| 目录 | 当前 App 可用的已授权作用域 |
| 生命周期 | 作用域的获取、续期、撤销 |
| Token 形状 | 强类型 bearer / 作用域 token surface |
| 边界 | App 消费作用域；token 颁发归 Runtime |

需要授权的 App 不会自创 token 形状。它们消费 scope 子路径；准入与否由 Runtime 决定。

## `sdk/mod` — 宿主注入的 mod 门面

mod 子路径是**宿主注入**的。mod 不会导入一个泛用 mod runtime；宿主（桌面端）把能力注入到 mod 的门面里。这就是 mod 始终被约束在准入 hook 能力范围内的原因。

| 属性 | 值 |
| --- | --- |
| 注入方向 | 宿主 → mod |
| Mod surface | `createHookClient(...)` 风格的宿主注入 |
| 存储 | `createModKvStore(...)`，sqlite 支撑 |
| Renderer 解耦 | mod 不直接和浏览器对话 |
| Tab 身份 | `tabId` 是唯一稳定的 runtime 身份 |
| UI 槽 | mod 渲染到准入的 UI 槽 |

mod 如果尝试导入泛用浏览器 surface 或泛用 runtime 模块，就是绕过边界；mod 只通过宿主注入消费。

## `sdk/mod` 暴露什么

| Surface | 用途 |
| --- | --- |
| Hooks | 准入的 hook 能力白名单 |
| UI 槽 | 准入的 UI 槽绑定（mod 可渲染到哪里） |
| i18n | mod 本地国际化 helper |
| Settings | mod 设置 surface |
| KV 存储 | sqlite 支撑的键值存储 |
| 生命周期 | `enable | disable | uninstall` |

每一项都按契约准入。新 surface 需要内核准入。

## 场景：App 读取自己的授权作用域

App 想知道自己能做什么。

1. **导入 scope。** `import { createScopeClient } from '@nimiplatform/sdk/scope';`。
2. **读取目录。** App 查询强类型作用域目录；列出已准入的作用域。
3. **生命周期订阅。** App 订阅作用域生命周期事件（获取、撤销）。
4. **使用。** 在某个作用域下行动时，App 引用作用域 id；Runtime 校验对应的准入 token。

App 不会假装拥有自己没有的作用域。scope 子路径是读真值，不是读改。

## 场景：Mod 注册 Hook 能力

某 mod 作者想让自己的 mod 对一次聊天回合作出反应。

1. **导入 mod surface。** `import { createHookClient } from '@nimiplatform/sdk/mod';`。
2. **宿主注入的 client。** mod 加载时由宿主（桌面端）注入 hook client。
3. **准入的 hook 点。** mod 在已准入的 turn-hook 点上注册。未准入的 hook 点会被拒绝。
4. **能力白名单。** mod 的能力就是它声明 profile 下被白名单允许的 hook。
5. **Runtime 事件到达。** 一次回合发生时，mod 在准入 hook 能力形状下收到强类型事件。
6. **Mod 响应。** 在白名单内行动；不会绕入原始 Runtime 或 Realm 调用。

如果 mod 想要一个内核未准入的 hook，唯一的正确路径是把这个 hook 准入进白名单。mod 没有侧门可走。

## 场景：Mod 存设置

mod 需要持久化用户专属设置。

1. **导入存储。** `import { createModKvStore } from '@nimiplatform/sdk/mod';`。
2. **打开 store。** 宿主为该 mod 注入一份 sqlite 支撑的 kv store。
3. **Get / set。** 对 store 做强类型 get / set / list。
4. **作用域。** store 是 mod 私有的；其他 mod 无法读。

mod 没有自己造一层存储；没有写文件到磁盘；没有滥用浏览器 localStorage。宿主注入的 store 才是准入路径。

## 为什么是两个子路径

`sdk/scope` 回答"这个 App 拥有什么授权"。`sdk/mod` 回答"这个 mod 拥有什么能力"。它们在概念上有重叠（都关于"什么被允许"），但解决的开发体验不同：

- App 开发者读 scope 来规划 UX 流程。
- Mod 开发者按 hook 能力注册以扩展桌面端。

让两个子路径各自独立，能让它们的契约都更清晰。

## 边界总览

| 关注点 | 归属 |
| --- | --- |
| 作用域目录 | Runtime 加准入的 scope 契约 |
| Token 颁发 | Runtime 权威 |
| Mod hook 白名单 | 桌面端内核 `hook-capability-contract` |
| Mod KV store 实现 | 宿主（桌面端）注入 |
| Mod UI 槽绑定 | 桌面端内核 `ui-slots` 表 |

## Source Basis

- [`.nimi/spec/sdk/scope.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/scope.md)
- [`.nimi/spec/sdk/mod.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/mod.md)
- [`.nimi/spec/sdk/kernel/scope-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/scope-contract.md)
- [`.nimi/spec/sdk/kernel/mod-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/mod-contract.md)
- [`.nimi/spec/sdk/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/boundary-contract.md)
- [`.nimi/spec/sdk/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/surface-contract.md)
- [`.nimi/spec/desktop/kernel/hook-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/hook-capability-contract.md)
- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml)
- [`.nimi/spec/desktop/kernel/tables/ui-slots.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/ui-slots.yaml)
- [`.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml)
- [`.nimi/spec/runtime/kernel/scoped-app-binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scoped-app-binding-contract.md)
- [`.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml)
