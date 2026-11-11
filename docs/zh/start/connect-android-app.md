<!-- nimi-docs: {"authority":["rule.nimi.platform.remote-clients.android-registration","rule.nimi.platform.remote-clients.android-development","rule.nimi.platform.ui-design-system.android-app-session","rule.nimi.zhiyu.local-partner-surface.android-entry","rule.nimi.platform.app-ecosystem.mobile-development-entry"],"sources":["kit/package.json","kit/auth/src/app/mobile.ts","kit/auth/android","apps/zhiyu/src/mobile/main.tsx","apps/zhiyu/capacitor.config.ts","apps/zhiyu/android","app-tools/lib/mobile-development.mjs"]} -->

# 接入已有 Android App

当前 Android 12+ 路径使用 Kit Capacitor 容器，与 Web 共用远程 Runtime 协议，织羽是参考 App。请使用[配套源码包与主机](/zh/start/install)；目前没有 `create --platform mobile` 脚手架，也不提供 App Tools APK 或应用商店发布流程。

## 选择回调载体

| 载体 | 前提 |
| --- | --- |
| 本机 `android-dev-scheme` | Debug 安装包、已登记的包名与签名指纹、精确私有 Scheme 回调，以及非生产 Realm 显式使用且经维护者审核的本地 Registry |
| 分发 `android-app-link` | 签名 App、已接纳的包名/证书与 HTTPS 回调、发布者域名上的 Digital Asset Links，以及系统已验证的 App Link |

开发 Scheme 不提供域名验证。生产 Realm 和公共 Registry 会拒绝该开发来源，Kit 也不会在两种载体间自动降级。两者均使用官方系统浏览器登录、PKCE/state 校验和同一套业务权限。

## 准备 App

使用已有原生工程，接入所需的 Capacitor App、Browser 和 NimiAppAccess 插件。Kit `auth/app/mobile` 提供 `createMobileNimiAppSession`。工厂参数与 `plugins.NimiAppAccess` 必须配置同一已准入客户端和 Realm；设置 `loggingBehavior: 'none'`，防止原生桥接记录登录载荷。适配器会核对安装包名、签名和所选回调载体。

在 `package.json` 声明真实的 App-owned `dev:android` 脚本，并在 `nimi.app.yaml` 声明 `local_development.mobile.command: pnpm run dev:android`。`nimi-app dev --platform mobile` 只负责调用它，不使用 Desktop 的 `--resume`、登记 selector 或 CDP 参数。原生工程、签名、设备访问和构建工具仍由 App 负责。

## 运行织羽参考入口

按[织羽 README](https://github.com/nimiplatform/nimi/blob/main/apps/zhiyu/README.md#android-本机开发)准备 JDK、Android SDK 与签名配置。启动已配置的 Realm、官方登录网站和 Nimi Home。PC 需为绑定的主 Runtime，开启远程接入，并完成 Android 来源准入与 Home 确认。

在 `apps/zhiyu` 目录运行：

```bash
pnpm build:mobile
pnpm sync:android
pnpm dev:mobile
```

仅在本机 USB 开发时，可对已授权设备使用 `adb -d reverse tcp:3000 tcp:3000` 与 `adb -d reverse tcp:3002 tcp:3002`，用于官方登录和协调。AI 与文件仍通过手机和 PC 的直接 peer 通道传输，反向端口可用不能证明业务直连成功。

在真机完成系统浏览器登录与回调，连接主 Runtime，进入已有伙伴并发送真实消息。共享 renderer 显示主机已有的 Conversation 和记忆，不创建 Android 自有 Agent。原生 Desktop Avatar 启动和原生包投放仍不可用。

## 生命周期与验证

进入后台会结束旧连接；回到前台时先核对身份，再重建先前活跃的技术连接，不重放消息或续接旧流。短期登录事务或内存上下文丢失时可能需要重新登录。“退出此应用”结束当前 App 上下文，不退出 PC Home 账号。

验收时，请结合所选来源和实际设备，逐项验证登录/回调、直连、真实对话结果、来源暂停或断线，以及前后台切换，并记录包与源码 revision、签名、Android 版本、主机和网络条件。类型检查、APK 构建或开发 Scheme 成功，都不能代替正式 App Link 验证。未实际运行验证的 App Link、生产来源和公网路径应保留 `NOT-VERIFIED`；iOS 则需要独立实现的适配器。

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
