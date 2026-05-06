# Scope 与 Mod

`@nimiplatform/sdk/scope` 把授权与目录生命周期暴给 App。`@nimiplatform/sdk/mod` 是宿主注入的 mod facade，mod 通过它消费能力。它们是不同的子路径，因为答的是不同问题；都被关在 SDK 边界里。

## `sdk/scope` — 授权暴露

Scope 子路径把授权状态投到类型化 App 表面。

| 关注 | scope 覆盖什么 |
| --- | --- |
| 目录 | 这个 App 能用的授权 scope |
| 生命周期 | Scope 获取、续期、撤销 |
| Token 形状 | 类型化 bearer / scoped token 表面 |
| 边界 | App 消费 scope；runtime 拥有 token 颁发 |

需要授权的 App 不发明 token 形状。它们消费 scope 子路径；准入与否由 runtime 决定。

## `sdk/mod` — 宿主注入的 mod facade

Mod 子路径是**宿主注入**的。Mod 不 import 一个通用 mod runtime；宿主（桌面端）把能力注入到 mod 的 facade 里。这就是把 mod 关在它准入的 hook 能力里的方式。

| 性质 | 值 |
| --- | --- |
| 注入方向 | 宿主 → mod |
| Mod 表面 | `createHookClient(...)` 风格的宿主注入 |
| 存储 | `createModKvStore(...)` — sqlite 撑底 |
| 渲染解耦 | Mod 不直接跟浏览器说话 |
| Tab 身份 | `tabId` 是唯一稳定的运行时身份 |
| UI 槽 | Mod 渲染到准入的 UI 槽里 |

试图 import 通用浏览器表面或通用 runtime 模块的 mod 绕过了边界；mod 消费的是宿主注入。

## `sdk/mod` 暴什么表面

| 表面 | 用途 |
| --- | --- |
| Hook | 准入的 hook 能力白名单 |
| UI 槽 | 准入的 UI 槽绑定（mod 在哪儿渲染） |
| i18n | mod 局部国际化辅助 |
| Settings | mod 设置面 |
| KV 存储 | sqlite 撑底的 key-value store |
| 生命周期 | `enable | disable | uninstall` |

每一项按合同准入。新表面需要 kernel 准入。

## 阅读场景：App 读自己的授权 scope

App 想知道自己能干什么。

1. **import scope。** `import { createScopeClient } from '@nimiplatform/sdk/scope';`。
2. **读目录。** App 查类型化 scope 目录；准入 scope 列出来。
3. **生命周期订阅。** App 订阅 scope 生命周期事件（acquired、revoked）。
4. **使用。** 在某 scope 下动作时，App 引用 scope id；runtime 按准入 token 校验。

App 不假装拥有自己没有的 scope。Scope 子路径是读真相，不是读改。

## 阅读场景：Mod 注册 hook 能力

Mod 作者写一个想响应聊天 turn 的 mod。

1. **import mod 表面。** `import { createHookClient } from '@nimiplatform/sdk/mod';`。
2. **宿主注入 client。** Mod 加载时宿主（桌面端）提供 hook client。
3. **准入 hook 点。** Mod 注册到一个准入的 turn-hook 点。未准入的 hook 点被拒。
4. **能力白名单。** Mod 的能力是它声明 profile 的白名单 hook。
5. **Runtime 事件到达。** 当一次 turn 发生，mod 在准入的 hook 能力形状下收到类型化事件。
6. **Mod 响应。** 在它的白名单里；从不绕进原始 Runtime 或 Realm 调用。

想要 kernel 还没准入的 hook 的 mod 只有一条正确路径：把 hook 准入到白名单。Mod 没法旁路。

## 阅读场景：Mod 存设置

Mod 要持久化用户特定的设置。

1. **import 存储。** `import { createModKvStore } from '@nimiplatform/sdk/mod';`。
2. **打开 store。** 宿主为这个 mod 注入一个 sqlite 撑底的 kv store。
3. **Get / set。** 类型化 get / set / list 操作。
4. **范围。** Store 是 mod 私有；别的 mod 读不到。

Mod 没自建存储层；没写文件到磁盘；没滥用浏览器 localStorage。宿主注入的 store 是准入路径。

## 为什么两条子路径

`sdk/scope` 答「这个 App 有什么授权」。`sdk/mod` 答「这个 mod 有什么能力」。它们概念上有交集（都是关于"被允许做什么"），但解的是不同开发者体验：

- App 开发者读 scope 来规划 UX 流。
- Mod 开发者注册到 hook 能力上来扩展桌面端。

两条子路径分清楚让各自的合同更利落。

## 边界总结

| 关注 | 所有者 |
| --- | --- |
| Scope 目录 | Runtime + 准入 scope 合同 |
| Token 颁发 | Runtime 权威 |
| Mod hook 白名单 | 桌面端 kernel `hook-capability-contract` |
| Mod KV store 实现 | 宿主（桌面端）注入 |
| Mod UI 槽绑定 | 桌面端 kernel `ui-slots` 表 |

## 来源

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
