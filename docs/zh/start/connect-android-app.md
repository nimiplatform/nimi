<!-- nimi-docs: {"authority":["rule.nimi.platform.remote-clients.android-registration","rule.nimi.platform.remote-clients.android-development","rule.nimi.platform.ui-design-system.android-app-session","rule.nimi.zhiyu.local-partner-surface.android-entry","rule.nimi.platform.app-ecosystem.mobile-development-entry"],"sources":["kit/package.json","kit/auth/src/app/mobile.ts","kit/auth/android","apps/zhiyu/src/mobile/main.tsx","apps/zhiyu/capacitor.config.ts","apps/zhiyu/android","app-tools/lib/mobile-development.mjs"]} -->

# 接入已有 Android App

Android 12+ App 通过 Kit Capacitor 容器接入主 PC Runtime，底层与 Web 共用同一套远程 Runtime 协议，织羽（`apps/zhiyu`）是参考实现。

使用这条路径时，请从 npm 的 `pre` 通道安装配套版本——App Tools `0.16.0-rc.10`、SDK `0.24.0-rc.10` 与 Kit `0.24.0-rc.16`（与 `latest` 区分），并搭配兼容版本的主机环境，详见[安装指南](/zh/start/install)。这些 `pre` 包已发布仅代表你可以本地构建与调试，不代表所有 Android 或 App Link 路径都已自动通过端到端验证。

目前没有 `create --platform mobile` 脚手架，也没有 App Tools APK 或应用商店发布流程。原生工程、签名、设备访问和构建工具仍由 App 自行维护。

## 选择 Realm 与回调载体

普通 Android debug 构建默认连接**官方 Realm**，并使用系统已验证的 **HTTPS App Link**（直接使用实际 debug 包名和 debug 签名证书，无需打 release APK）。只有在显式传入 `--realm local` 指向本地非生产 Realm 时，才会使用登记好的本地开发 Scheme。

| 模式 | 回调载体 | 前提条件 |
| --- | --- | --- |
| 默认（含普通 Android debug 构建） | `android-app-link` | 已准入的包名与签名证书（debug 或 release 均可）、HTTPS 回调、域名上的 Digital Asset Links，以及系统已验证的 App Link |
| 显式 `--realm local` | `android-dev-scheme` | Debug 安装包、已登记的包名与签名指纹、精确的私有 Scheme 回调，以及配置了经维护者审核本地 Registry 的非生产本地 Realm |

两点边界需要注意：

- `android-dev-scheme` 不做域名验证。官方生产 Realm 和公共 Registry 会拒绝这种来源，Kit 也不会在两种载体之间自动降级。
- 两种载体都走官方系统浏览器登录、PKCE/state 校验和同一套业务权限模型。

## 改造你的 Android 工程

从已有的原生 Android 工程出发，接入 Capacitor 的 `App`、`Browser` 和 `NimiAppAccess` 插件：

1. 从 Kit 的 `auth/app/mobile` 引入 `createMobileNimiAppSession`。
2. 在会话工厂和 `plugins.NimiAppAccess` 中配置完全一致的已准入客户端与 Realm。
3. 设置 `loggingBehavior: 'none'`，避免原生桥接记录登录载荷。适配器会在运行时核对安装包名、签名和所选回调载体。
4. 在 `package.json` 添加真实的 `dev:android` 脚本，并在 `nimi.app.yaml` 中声明 `local_development.mobile.command: pnpm run dev:android`。

执行 `nimi-app dev --platform mobile` 时，App Tools 只负责转调这条脚本；Desktop 的 `--resume`、登记 selector 和 CDP 参数在这里都不适用。

## 跑通织羽参考工程

先按[织羽 README](https://github.com/nimiplatform/nimi/blob/main/apps/zhiyu/README.md#android-普通开发与本地联调)准备好所需的 JDK、Android SDK 和签名配置。

普通开发机直接使用已安装且兼容的 Nimi Home 和主 PC Runtime 即可，无需在本地运行 Realm：确认 PC 已绑定为主 Runtime、开启远程接入，并先在 Registry 登记 Android 来源，首次接入时在 Home 中确认。（只有当你准备使用 `--realm local` 时，才需要启动本地 Realm 与本地登录服务。）

在 `apps/zhiyu` 中运行 `pnpm dev:mobile`。它会构建并同步 Android 工程，然后启动应用。

如果配置的是本地非生产 Realm，请先在已授权的 USB 设备上准备登录和协调端口，再启动本地模式：

```bash
adb -d reverse tcp:3000 tcp:3000
adb -d reverse tcp:3002 tcp:3002
pnpm dev:mobile -- --realm local
```

AI 对话和文件传输依然走手机与 PC 之间的直接 peer 通道，所以反向端口通了并不等于业务直连已通。

在真机上完成系统浏览器登录与回调，连上主 Runtime，打开已有伙伴并发送真实消息。共享 renderer 会展示主机已有的 Conversation 和记忆，不会在 Android 侧创建自有 Agent；原生 Desktop Avatar 启动和原生包投放目前也不可用。

## 处理生命周期与真机自查

移动端的连接和登录状态遵循明确边界：

- 切到后台会关闭旧连接。
- 回到前台会先重新核对身份，再重建先前活跃的连接，不会重放消息或续接中断的流。
- 短期登录事务或内存上下文丢失时，可能需要重新登录。
- “退出此应用”只结束当前 App 的会话，不会退出 PC Home 账号。

上线或交付前，建议在目标真机和对应来源上完整跑一遍：登录与回调、直连建链、真实对话往返、来源暂停或断线恢复，以及前后台切换，并记下测试时的包与源码 revision、签名证书、Android 版本、主机状态和网络环境。

类型检查通过、打出 APK 或在 `android-dev-scheme` 下跑通，都不能代替真实 HTTPS App Link 或公网路径的验证。未实测的 App Link、生产来源和公网场景请继续标记为 `NOT-VERIFIED`。iOS 端需要独立实现对应的适配器。
## Source Basis

- [`.nimi/spec/platform/remote-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/remote-clients.authority.yaml)
- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`.nimi/spec/zhiyu/local-partner-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/zhiyu/local-partner-surface.authority.yaml)
- [`apps/zhiyu/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/zhiyu/README.md)
- [`apps/zhiyu/package.json`](https://github.com/nimiplatform/nimi/blob/main/apps/zhiyu/package.json)
- [`apps/zhiyu/capacitor.config.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/zhiyu/capacitor.config.ts)
- [`kit/auth/README.md`](https://github.com/nimiplatform/nimi/blob/main/kit/auth/README.md)
- [`kit/auth/src/app/mobile.ts`](https://github.com/nimiplatform/nimi/blob/main/kit/auth/src/app/mobile.ts)
- [`app-tools/lib/mobile-development.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/mobile-development.mjs)
