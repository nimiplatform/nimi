<!-- nimi-docs: {"authority":["rule.nimi.platform.app-ecosystem.scaffold-web-carrier","rule.nimi.platform.remote-clients.web-registration","rule.nimi.sdks.client-core.remote-runtime-carrier"],"sources":["app-tools/package.json","app-tools/bin/nimi-app.mjs","app-tools/lib/web-development.mjs","app-tools/lib/web-scaffold.mjs","sdks/typescript/package.json","kit/package.json","kit/auth/src/app/web.ts","sdks/typescript/runtime/remote.ts"]} -->

# 让 Web App 连接 PC Runtime

你可以在本机或另一台设备的浏览器中使用主 Runtime。当前 Web 入口需要[源码包组合](/zh/start/install)；已发布的 App Tools `0.14.0` 制品没有 `--platform web`。

## 准备主机和网站来源

保持主 PC Runtime 运行并登录 Home，通过官方账号流程绑定主 Runtime、开启远程接入，再准备任务需要的 Local Loadout 或 Cloud Connector。

网站需有经 Registry 接纳的客户端，登记精确的 canonical App ID、client ID、HTTPS origin 与同源回调。请由维护者接纳真实来源，创建工程不会产生批准。首次使用时，用户在 Home 确认该来源；正常重连或换浏览器无需新增设备审批，来源发生实质版本变化时才需重新确认。

浏览器必须信任网站证书，客户端与 PC 也必须具备直连条件。当前没有 TURN/Relay 兜底，不能通过关闭 TLS 验证来使用开发来源。

## 新建或接入网站

在包含所选完整源码归档的目录中运行：

```bash
pnpm dlx --package="file:$PWD/nimi-packages/nimiplatform-app-tools-0.14.0.tgz" nimi-app create \
  --dir my-web-app --profile standalone --platform web \
  --features studio-create --app-id com.example.web --title "My Web App"
```

按[独立工程 overrides](/zh/start/install#source-package-archives)选择匹配的 SDK、Kit 和 App Tools 归档，然后在新工程中运行 `pnpm install`、`pnpm run init`。当前 Web 的 `--features all` 只包含已接纳的 `studio-create`：文本生成、流式聊天和向量计算。

在 `nimi.app.yaml` 中配置 `local_development.web` 的 `origin`、`redirect_uri`、`client_id`、`realm_environment_id`、`realm_url`、`official_web_url` 和实际 App 命令 `command`。这些值必须匹配已准入来源，以及 PC 使用的 Realm 环境。在 App 的 `.env.local` 中设置 `NIMI_WEB_TLS_KEY`、`NIMI_WEB_TLS_CERT`，指向浏览器已信任的证书文件。

已有网站需先准备真实的 `nimi.app.yaml` 和 `.nimi/config/build-profile.yaml`：manifest 使用 `platform: web`，构建配置使用 `web-pnpm` 并声明实际测试与构建命令。文件尚未创建时，`nimi-adoption.json` 只包含 `manifest` 和/或 `build_profile` 对象，具体流程见[已有 App 接入指南](https://github.com/nimiplatform/nimi/blob/main/app-tools/skills/nimi-app-lifecycle/references/adapt.md)。已有文件齐全时可省略 `--input`。

已有网站可用所选源码工具执行 `init --adopt --input ./nimi-adoption.json --dry-run --json` 预览受管变更，再去掉 `--dry-run` 应用。保留网站实际的产品入口、测试/构建命令和账号系统；`web-pnpm` 构建归属见 [App Tools](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)。原生工程也可声明额外的 App-owned Web 开发入口，这不会改变其原生构建配置。

## 登录并完成真实调用

```bash
pnpm run check
pnpm run test
pnpm run app:build
pnpm dev
```

Web 开发载体打开配置的 HTTPS 来源。点击 Nimi 登录，完成官方浏览器流程；需要时在 PC Home 确认来源，再连接主 Runtime。登录成功与 PC 可连接是两个状态，应分别呈现。

在 AI Studio 中选择并保存该 App 的 AIConfig，然后提交文本请求，观察实际返回文字、流或 owner 错误。App 设置保存使用意图，主机模型准备仍在 PC 管理界面完成。类型化调用见 [Runtime 客户端](/zh/sdk/runtime-client)。

Kit `auth/app/web` 提供会话工厂，`auth/app` 提供 Provider、AccountControl 和 AccessGate。业务动作捕获当前连接 scope 的 client 和 signal；scope 失效时卸载旧视图，阻止迟到结果回写。已有网站的可选账号关联必须跟随网站已验证的当前用户；只使用 Nimi 登录时无需再建账号系统。

## 断线、持久任务与交付

关闭页面或断开连接会结束实时调用，不会停止 PC Runtime。旧流不自动续接，不确定是否成功的 Submit 也不重放。保存持久 Job 或提交标识，查询其真实状态；对应工作流提供 `lookupSubmission` 时，用它查找已提交任务。

开发服务只协调身份与连接，AI 内容、文件和结果直接传到 PC。生产网站另需已准入的正式来源、可信 HTTPS 和受限的协调路由。浏览器构建得到静态资源，不提供 Web `pack`、自动发布或原生包安装。

## Source Basis

- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/platform/remote-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/remote-clients.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`kit/auth/README.md`](https://github.com/nimiplatform/nimi/blob/main/kit/auth/README.md)
- [`examples/remote-runtime-web/README.md`](https://github.com/nimiplatform/nimi/blob/main/examples/remote-runtime-web/README.md)
