# Platform Kit

`@nimiplatform/kit` 为 Nimi App 提供可复用 UI 与宿主接入构件。真实
consumer 可以共享视觉语言、无障碍行为、shell adapter 与常用交互 primitive，
产品真相不会因此进入 Kit。

## 当前职责

| Kit surface | 职责 |
| --- | --- |
| `ui` | 共享 token、theme 与 UI primitive |
| `auth` | 可复用 authentication presentation 与 adapter |
| `core` | 宿主无关 utility 与 capability helper |
| `telemetry` | Renderer telemetry 与 error-boundary helper |
| `shell/tauri` | 有界 native-host glue |

Kit 按真实需求扩展。只有真实 App 或宿主需要复用同一行为，而且产品 owner
已经明确时，才增加 reusable surface。Kit 不为“生态完整”预建公共功能目录。

## Owner 边界

Kit 可以持有可复用呈现与宿主无关交互行为，但不持有：

- App 特有产品流程或布局；
- Runtime 的 LocalAgent、Conversation、Memory、Knowledge 或 readiness；
- Realm 的世界、Character、账户或社交真相；
- Avatar 执行或渲染权威；
- Provider 路由、后端执行或 authorization truth。

App 通过公共 subpath 引入 Kit，并在本地组合 primitive。App 不导入 Kit
私有路径，也不在 App 本地重复建立共享 primitive owner。

## 场景：复用共享 Dialog

一个 App 需要使用第一方表面已有的无障碍确认 Dialog。

1. App 引入 Kit 的公共 Dialog 与共享 semantic token。
2. App 提供自己的产品文案与 action handler。
3. Kit 负责焦点管理、键盘行为与共享视觉语义。
4. 产品决策仍归 App，可复用交互 primitive 仍归 Kit。

视觉系统细节见[设计模式](/zh/platform/kit/design-pattern)，App 接入方式见
[在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)。

## 来源依据

- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
