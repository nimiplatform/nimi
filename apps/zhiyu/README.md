[App introduction and usage](NIMI_APP.md)

# 织羽开发

织羽默认使用 Nimi 账号，与既有伙伴的身份、Conversation、记忆及配置交互。Web 和 Desktop 共享产品 renderer，通过 SDK／Kit 的不同平台入口接入；应用不保管 Nimi 账号凭据，也不建立另一套伙伴或用户系统。

## Web 开发

需要 Node/pnpm、已安装且包含本分支共享接入出口的 SDK／Kit／App Tools，以及运行中的 Realm 官方登录服务。服务主机上的 Nimi Home 需登录、启用远程接入并准备好伙伴；网页所在设备不要求再安装 Runtime。当前本机联调使用以下已接纳来源：

- App：`nimi.zhiyu`；客户端：`nimi.zhiyu.web.dev`。
- 来源：`https://127.0.0.1:4472`；回调：同来源 `/`。
- 环境与官方服务地址位于 `nimi.app.yaml` 的 `local_development.web`。

新来源需要 Registry 接纳和主机 Home 一次确认；原来源正常重连、开发重启或包更新复用既有许可。更改域名或回调不能沿用旧来源假装已接纳。

1. 将 `.env.web.example` 复制为 `.env.web.local`，填写浏览器已信任证书的 key/cert 路径。现有本机文件可直接复用，不提交私钥。
2. 在织羽目录执行 `pnpm dev:web`，由 App Tools 的 Web 载体启动正式 HTTPS 入口。
3. 点击“使用 Nimi 账号登录”，完成官方页面流程后连接主 Runtime；首次使用来源时在主机 Home 确认。

浏览器已登录与 PC 在线是两个状态。断开只关闭当前 Runtime 连接；“退出此应用”结束当前应用上下文，不退出 Home 或其它应用。重新连接不会重复提交旧业务。真实功能验证必须走此入口，不能以直接 Vite 页面或构建成功代替。

常用命令在织羽目录运行：

```sh
pnpm typecheck
pnpm test
pnpm build:web
pnpm dev:web
```

`typecheck`、`test` 和两种 renderer 构建只消费已安装的公开包，不调用 Nimi 父仓脚本。输出 `dist-web/` 是网页资源，不是已部署网站。App Tools 提供的开发服务只协调身份和连接；生产托管需要相同的正式协调路由，AI／文件仍直达 PC，不加入 Relay 或网站后端业务转发。

## 工作区源码联调

在 Nimi 仓库根目录安装依赖并准备当前 SDK／Kit，然后启动 Home：

```sh
pnpm install
pnpm dev:prepare
pnpm dev:desktop
```

在另一终端运行 `pnpm --filter @nimiplatform/zhiyu dev:web`。更新 SDK／Kit 源码后重新准备包，必要时重启 App 开发服务；织羽没有源码 alias 或仓库 CSS 扫描兜底。工作区的 `workspace:*` 只负责选择包，仍通过公开 exports 消费构建产物。

## 独立目录消费与更新

复制同一份织羽源码到独立目录，排除 `node_modules`、构建目录和本机 `.env*.local`；不要重新生成一个业务不同的样例。

1. 将 `package.json` 中 SDK、Kit 和 App Tools 的 `workspace:*` 改成所选完整包的版本。当前开发组合为 SDK `0.22.2`、Kit `0.22.1`、App Tools `0.14.0`；这些数字本身不保证 npm 上已有本分支新增接口。
2. 若使用本地源码包，在该目录的 `pnpm-workspace.yaml` 中通过 `overrides` 选定完整 `.tgz`，包括 Kit 需要的同版本 native optional 包。三者必须是兼容的目标组合；不得改成指向父仓源码目录的依赖。
3. 执行 `pnpm install`，保留实际 lockfile。随后运行上面的类型检查、测试和 Web 构建；复制 TLS 示例并填写本机路径后，通过原已批准来源启动。
4. 更新时先检查当前 Git 修改，再更换选定包／override，重新安装并按 package migration notes 修改应用调用。查看 diff，确认业务源码、App ID、来源、回调和用户自有修改未被覆盖，再运行受影响检查与真实业务。

同一开发版本号的两个 tarball 可以包含不同源码；保留所选文件路径和 lock integrity，不只按版本号判断更新成功。织羽是手写应用，没有 scaffold-managed glue，不通过伪造 scaffold lock 或 `sync` 来覆盖业务入口。当前没有宣称同目录 Desktop/Web 的 `init/sync/check/test/build` 全部由 App Tools 统一选择。

`build:electron` 是 Nimi 仓库内的受监督 Host 构建脚本，独立 Web 迭代不调用它。本轮不提供独立原生分发／安装流程，也不发布 `zhiyu.nimi.ai`。

## Desktop 联调

主机 Home 就绪后，在仓库根目录执行 `pnpm dev:zhiyu -- --list-registrations`，按返回的当前 selector 用 `pnpm dev:zhiyu -- --resume <selector>` 继续原登记。原生 App 经 Desktop supervisor 和正式 Host 接入，账号登录、切换与全局退出仍在 Home 管理。

`pnpm build` 检查共享 TypeScript 并构建原生 renderer；`dev:renderer` 只供纯布局调试，不能建立受保护 App 会话或证明伙伴调用成功。工作区环境说明见 [LOCAL_DEVELOPMENT.md](../../LOCAL_DEVELOPMENT.md)。

## 共享接入与验证边界

Web 使用 Kit `auth/app/web`，Desktop 使用 `auth/app/desktop`；两者共享 Provider、AccountControl 和 AccessGate。业务组件捕获当前 scope 的客户端，身份失效或断开时卸载旧视图。可选自有账号关联通过 Kit 输出当前上下文的 verified identity，网站自己的后端仍负责正式验证；织羽默认无需此关联层。

已有 Web 版本实际运行过文本聊天、既有会话重读、伙伴配置和 skin 预览／应用／清除。共享接入与公开包迁移后的真实页面复验单独记录，工程检查通过不能代替新版产品路径。原生 Avatar 启动／placement 不被网页模拟；其它语音／媒体组合及公网条件按实际应用任务验证。Mobile 仍待原生来源、系统回调和容器实现，没有空的 Mobile 工厂。


## Android 本机开发

`src/mobile/main.tsx` 与 Web 共用 `production/remote-entry` 和同一 renderer。当前 Android 12+ 开发包为 `ai.nimi.apps.zhiyu.dev`，Nimi 客户端为 `nimi.zhiyu.android.dev`，配置位于 `capacitor.config.ts`。开发回调使用 `ai.nimi.apps.zhiyu.dev:/oauth/callback`，由 debug Manifest 声明，无需部署公网域名。

先在本机开发 Realm 使用的 Registry 登记 `android-dev-scheme` 来源、精确回调、包名和实际 debug 签名指纹，沿用维护者接纳和 Home 首次确认。Realm 只从显式本地 Registry 在非生产环境接受此类型；生产和公共 Registry 响应拒绝。Kit 核对 debug 宿主、安装包签名和回调，登录仍由系统浏览器完成，授权码/PKCE/state 与业务权限完全复用。它不提供 App Link 的域名证明，也不自动降级正式来源。

安装所选完整 SDK/Kit 与 Capacitor 包并配置 JDK/Android SDK 后，启动本机 Realm、官方登录 Web 和 Nimi Home。USB 设备允许调试后，可在 Android SDK 的 adb 命令目录准备登录与协调端口：

```sh
adb -d reverse tcp:3000 tcp:3000
adb -d reverse tcp:3002 tcp:3002
pnpm build:mobile
pnpm sync:android
pnpm dev:mobile
```

`dev:mobile` 经 App Tools 调用应用自己的 `dev:android`，由 Capacitor 构建和运行。它不受 Desktop supervisor 托管。首次使用新来源时，用户在系统浏览器完成 Nimi 登录，并在 PC Home 确认该来源；普通同签名更新与重连不重复批准。

USB reverse 仅提供本机开发登录和 Realm 协调，AI/文件仍由手机与 Runtime 的既有直接 peer 传输；PC 与手机需要具备直连条件。保留 `loggingBehavior: 'none'`，防止原生桥接调试日志记录登录参数。后台结束旧连接，恢复时重新核对当前身份和技术连接，不重放业务或续接旧流。

Debug 明文网络例外仅覆盖 localhost/127.0.0.1；其它目标仍要求 TLS。可通过 Gradle `-PnimiDebugKeystore=<path>` 使用自己的开发签名；该指纹须与来源登记一致。当前本机工具为 JDK 21、compileSdk 37、targetSdk 36、minSdk 31。正式分发使用单独接纳的 `android-app-link` 来源、HTTPS 回调与 Android Digital Asset Links；debug Scheme 只编入 debug Manifest。完整 App Link 分发验证不由本地 Scheme 结果代替。
