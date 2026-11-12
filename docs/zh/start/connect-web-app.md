<!-- nimi-docs: {"authority":["rule.nimi.platform.app-ecosystem.scaffold-web-carrier","rule.nimi.platform.remote-clients.web-registration","rule.nimi.sdks.client-core.remote-runtime-carrier"],"sources":["app-tools/package.json","app-tools/bin/nimi-app.mjs","app-tools/lib/web-development.mjs","app-tools/lib/web-scaffold.mjs","sdks/typescript/package.json","kit/package.json","kit/auth/src/app/web.ts","sdks/typescript/runtime/remote.ts"]} -->

# 让 Web App 连接 PC Runtime

你可以在本机或另一台设备的浏览器中使用主 Runtime。当前 Web 入口需要[源码包组合](/zh/start/install)；已发布的 App Tools `0.14.0` 制品没有 `--platform web`。

## 准备主机和网站来源

保持主 PC Runtime 运行并登录 Home，通过官方账号流程绑定主 Runtime、开启远程接入，再准备任务需要的 Local Loadout 或 Cloud Connector。

网站需使用已在 Registry 准入的客户端，并登记精确的 canonical App ID、client ID、HTTPS origin 与同源回调。真实来源需由维护者完成准入，仅在本地创建工程不会自动获得批准。用户首次使用时需在 Home 确认该来源；此后正常重连或更换浏览器无需再次审批设备，来源发生实质版本变化时需要重新确认。

浏览器必须信任网站证书，客户端与 PC 也必须具备直连条件。当前没有 TURN/Relay 兜底，不能通过关闭 TLS 验证来使用开发来源。

## 新建或接入网站

在包含所选完整源码归档的目录中运行：

```bash
pnpm dlx --package="file:$PWD/nimi-packages/nimiplatform-app-tools-0.15.0.tgz" nimi-app create \
  --dir my-web-app --profile standalone --platform web \
  --features studio-create --app-id com.example.web --title "My Web App"
```

按[独立工程 overrides](/zh/start/install#source-package-archives)选择匹配的 SDK、Kit 和 App Tools 归档，然后在新工程中运行 `pnpm install`、`pnpm run init`。当前 Web 的 `--features all` 只包含已接纳的 `studio-create`：文本生成、流式聊天和向量计算。

在 `nimi.app.yaml` 中配置 `local_development.web` 的 `origin`、`redirect_uri`、`client_id`、`realm_environment_id`、`realm_url`、`official_web_url` 和实际 App 命令 `command`。这些值必须匹配已准入来源，以及 PC 使用的 Realm 环境。在 App 的 `.env.local` 中设置 `NIMI_WEB_TLS_KEY`、`NIMI_WEB_TLS_CERT`，指向浏览器已信任的证书文件。

接入已有网站时，需先准备真实的 `nimi.app.yaml`（设置 `platform: web`）和 `.nimi/config/build-profile.yaml`（使用 `web-pnpm` 并声明实际的测试与构建命令）。若其中任一文件尚未创建，可通过 `nimi-adoption.json` 传入 `manifest` 和/或 `build_profile` 对象，具体流程见[已有 App 接入指南](https://github.com/nimiplatform/nimi/blob/main/app-tools/skills/nimi-app-lifecycle/references/adapt.md)；若文件已齐全，则可省略 `--input`。

已有网站可使用所选源码工具执行 `init --adopt --input ./nimi-adoption.json --dry-run --json` 预览受管变更，确认无误后去掉 `--dry-run` 正式应用。接入时请保留网站原有的产品入口、测试与构建命令及账号系统；`web-pnpm` 的构建归属详见 [App Tools](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)。此外，原生工程也可声明额外的 App 自有（App-owned）Web 开发入口，不会改变原有的原生构建配置。

## 登录并完成真实调用

```bash
pnpm run check
pnpm run test
pnpm run app:build
pnpm dev
```

启动后，在浏览器中打开终端显示的已配置 HTTPS 地址。点击 Nimi 登录并完成官方浏览器授权流程；需要时在 PC Home 确认该来源，再连接主 Runtime。登录成功与 PC Runtime 可连接属于两个独立状态，界面中应分别呈现。

在 AI Studio 中选择并保存该 App 的 AIConfig，然后提交文本请求，确认实际返回的文本、流式输出或 owner 错误。App 设置仅保存使用意图，主机侧的模型准备仍需在 PC 管理界面中完成。类型化调用方式见 [Runtime 客户端](/zh/sdk/runtime-client)。

Kit 的 `auth/app/web` 提供会话工厂，`auth/app` 提供 Provider、AccountControl 和 AccessGate。执行业务操作时应捕获当前连接 scope 的 client 和 signal；当 scope 失效时及时卸载旧视图，防止迟到的返回结果回写界面。已有网站若启用可选的账号关联，必须绑定网站已验证的当前用户；仅使用 Nimi 登录时无需另建账号系统。

## 断线、持久任务与交付

关闭页面或断开连接会结束实时调用，不会停止 PC Runtime。旧流不自动续接，不确定是否成功的 Submit 也不重放。保存持久 Job 或提交标识，查询其真实状态；对应工作流提供 `lookupSubmission` 时，用它查找已提交任务。

开发服务仅负责协调身份与连接，AI 内容、文件和结果直接在客户端与 PC 之间传输。生产环境网站还需配置已准入的正式来源、可信 HTTPS 及受限的协调路由。浏览器构建产物为静态资源，不提供 Web `pack`、自动发布或原生包安装。

## Source Basis

- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/platform/remote-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/remote-clients.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`kit/auth/README.md`](https://github.com/nimiplatform/nimi/blob/main/kit/auth/README.md)
- [`examples/remote-runtime-web/README.md`](https://github.com/nimiplatform/nimi/blob/main/examples/remote-runtime-web/README.md)
