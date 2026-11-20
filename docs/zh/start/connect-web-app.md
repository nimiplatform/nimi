<!-- nimi-docs: {"authority":["rule.nimi.platform.app-ecosystem.scaffold-web-carrier","rule.nimi.platform.remote-clients.web-registration","rule.nimi.sdks.client-core.remote-runtime-carrier"],"sources":["app-tools/package.json","app-tools/bin/nimi-app.mjs","app-tools/lib/web-development.mjs","app-tools/lib/web-scaffold.mjs","sdks/typescript/package.json","kit/package.json","kit/auth/src/app/web.ts","sdks/typescript/runtime/remote.ts"]} -->

# 让 Web App 连接 PC Runtime

通过 Web App，你可以在本机或其他设备的浏览器里直接使用绑定的主 PC Runtime。

Web 项目的脚手架和工具链已发布在 npm 的 `pre` 通道——App Tools `0.16.0-rc.9`、SDK `0.24.0-rc.10` 和 Kit `0.24.0-rc.16`（与 `latest` 区分），具体版本搭配与主机要求见[安装指南](/zh/start/install)。这些 `pre` 包可供本地建项与联调，但包已发布并不等同于端到端产品路径自动通过验证。

## 1. 准备 PC Runtime 与网站来源

普通开发机直接使用已安装且兼容的 Nimi Home 和主 PC Runtime 连接官方 Realm 即可，无需自建或运行本地 Realm。

先确认主机侧准备就绪：

- 保持主 PC Runtime 运行，登录 Home，并通过官方账号流程将其绑定为主 Runtime。
- 开启远程接入，准备好业务需要的 Local Loadout 或 Cloud Connector。

网站侧需要在 Registry 中完成来源准入，登记精确的 canonical App ID、client ID、HTTPS origin 和同源回调。在本地新建工程不会自动获得准入，必须由维护者审核真实来源。用户首次使用时会在 PC Home 确认该来源；之后正常重连或换浏览器无需重复审批，但来源发生实质变更时需要重新确认。

另外，浏览器必须信任网站证书（开发时也不要关闭 TLS 校验），客户端与 PC 之间需具备直连条件——当前没有 TURN/Relay 中继兜底。

## 2. 新建 Web App，或接入已有网站

### 从零新建

使用 `pre` 通道的 App Tools 创建独立 Web 工程：

```bash
pnpm dlx --package=@nimiplatform/app-tools@0.16.0-rc.9 nimi-app create \
  --dir my-web-app --profile standalone --platform web \
  --features studio-create --app-id com.example.studio --title "My Web App"
```

目前 Web 端的 `--features all` 对应已接纳的 `studio-create` 能力切片：文本生成、流式聊天和向量计算。

进入 `my-web-app`，运行 `pnpm install` 安装脚手架声明的依赖。填好 Web 配置后再运行 `init`、`check` 和 `dev`：

1. 在 `nimi.app.yaml` 的 `local_development.web` 下填入已准入的 `origin`、`redirect_uri`、`client_id`、`realm_environment_id`、`realm_url`、`official_web_url` 以及真实的 App 启动命令 `command`，确保与 PC 所连的 Realm 环境一致。
2. 在 `.env.local` 中将 `NIMI_WEB_TLS_KEY` 指向 HTTPS 私钥文件，将 `NIMI_WEB_TLS_CERT` 指向配套证书文件。浏览器需要信任这张证书。
3. 执行 `pnpm run init`。

### 接入已有网站

先在网站工程安装所选版本的 `@nimiplatform/app-tools` 为开发依赖，再从工程根目录运行下列命令。

先准备好真实的 `nimi.app.yaml`（设置 `platform: web`，并填好已准入的 `local_development.web` 配置）和 `.nimi/config/build-profile.yaml`（使用 `web-pnpm` 并声明真实的测试与构建命令）。如果其中任一文件还不存在，可按[已有 App 接入指南](https://github.com/nimiplatform/nimi/blob/main/app-tools/skills/nimi-app-lifecycle/references/adapt.md)准备只包含缺失的 `manifest` 和/或 `build_profile` 对象的 `nimi-adoption.json`；两个文件都齐全时可省略 `--input`。

先预览受管变更，确认后再正式写入：

```bash
pnpm exec nimi-app init --adopt --input ./nimi-adoption.json --dry-run --json
pnpm exec nimi-app init --adopt --input ./nimi-adoption.json
```

接入过程请保留网站原有的产品入口、测试与构建命令及账号体系；`web-pnpm` 的构建归属详见 [App Tools](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)。原生工程也可以额外声明 App 自有的 Web 开发入口，不会改动原有的原生构建配置。

### 已有桌面 App 增加网页入口

沿用桌面工程的 `app_id`、Electron 入口和原生构建配置。先按[安装指南](/zh/start/install)选好支持 Web 的 App Tools、SDK 和 Kit 组合。在 `local_development` 里为 `electron` 并列增加 `web`，让 `web.command` 指向网页开发脚本。浏览器入口使用 Kit 的 Web 会话；为它单独配置 Vite，并提供 `build:web:release` 脚本，以 `web-release` 模式构建。在 Vite 配置中调用 `@nimiplatform/app-tools/web` 的 `nimiWebViteConfig`，传入 `release: mode === 'web-release'`。两端可以共用业务逻辑。缺少模型配置时，用户应能在网页内找到设置并继续原来的任务。

先执行 `pnpm exec nimi-app sync --dry-run --json` 核对变更，再运行 `pnpm exec nimi-app sync`、`pnpm exec nimi-app check`。使用 `pnpm exec nimi-app dev --platform web` 启动网页端。共用逻辑发生变化时，在两个入口各走一次受影响的任务。后续更换平台包，按[已有项目升级指南](https://github.com/nimiplatform/nimi/blob/main/app-tools/skills/nimi-app-lifecycle/references/upgrade-platform.md)更新并锁定依赖。

## 3. 本地运行并完成首次真实调用

配置就绪且 `init` 完成后，依次检查、构建并启动开发服务：

```bash
pnpm run check
pnpm run test
pnpm run app:build
pnpm dev
```

在浏览器打开终端输出的 HTTPS 地址：

1. 点击 Nimi 登录入口，走完官方浏览器授权流程。
2. 如有提示，在 PC Home 确认来源后连接主 Runtime。注意登录成功与 PC 可连接是两个独立状态，界面应分开呈现。
3. 在 AI Studio 中选择并保存 App 的 `AIConfig`，提交一条文本请求，验证真实返回的文本、流式输出或 owner 错误。App 配置只表达使用意图，模型准备仍在 PC 主机侧完成；类型化接口见 [Runtime 客户端](/zh/sdk/runtime-client)。

## 4. 处理鉴权、作用域与断线

Kit 的 `auth/app/web` 提供会话工厂，`auth/app` 提供 `NimiAppSessionProvider`、`NimiAccountControl` 和 `NimiAppAccessGate`：

- 每次发起业务调用时，捕获当前连接 scope 的 `client` 和 `signal`。当 scope 失效时及时卸载旧视图，防止迟到的结果回写界面。
- 如果网站启用了可选的本地账号关联，必须严格绑定到网站已验证的当前用户；只用 Nimi 登录时无需另建账号系统。
- 关闭标签页或断开连接只会结束浏览器侧的实时调用，不会停止 PC Runtime。中断的流不会自动续接，状态不确定的 `Submit` 也不会自动重放。请保存持久的 Job 或提交标识以查询真实状态，工作流支持时可使用 `lookupSubmission` 检索。

## 5. 发布你的 Web App

调用 Runtime 时，网站服务端负责协调登录和连接。AI 内容、文件和结果直接在浏览器与 PC 之间传输。

浏览器构建产物是静态资源。执行构建不会自动发布或上线，Web 形态也不使用桌面端的 `pack` 或原生包安装。

正式发行有两条路径可选：

- **独立域名部署**：自行托管在已准入的域名上，配置可信 HTTPS 与受限的协调路由。
- **平台托管候选**：声明 `public_slug` 生成不可变托管候选，走受保护的 `web-v*` 发布流程并提交 Registry 审核。平台核实获准来源和构建产物后，候选版本才可上线。

### 发布到 nimi.xyz

1. 为产品选定长期使用的公开短名。使用已发布的 App Tools `0.16.0-rc.9` 时，先完成首次 `init`，再在 `nimi.app.yaml` 写入 `public_slug`。运行 `pnpm exec nimi-app sync`，提交生成的 `.github/workflows/nimi-web-release.yml`。
2. 设置 `NIMI_WEB_VERSION=X.Y.Z` 和 `NIMI_WEB_ARCHIVE=nimi-web-X.Y.Z.zip`，其中版本替换为本次实际版本。网页工程运行 `pnpm run build:release`，双端工程运行 `pnpm run build:web:release`。打开 ZIP，核对根目录的 `index.html`、`nimi-web-bundle.json` 中的来源和版本，以及 `/_releases/X.Y.Z/` 下的资源。
3. 在 App 自己的 GitHub 仓库启用不可变 Release，为 `web-v*` 配置禁止更新和删除的标签保护。从已测试的提交发布 `web-vX.Y.Z`，按 [Registry 说明](https://github.com/nimiplatform/nimi-app-registry#remote-application-sources)在同一 PR 提交托管来源和确切版本。此次审核一并完成正式网页来源登记。使用其他 HTTPS 地址联调真实 Runtime 时，该开发来源须单独准入。
4. 合并后，平台核实版本、上传资源并切换线上指针。从 `https://nimi.ai/apps/<slug>` 点击网页入口，确认打开 `https://<slug>.nimi.xyz`。开发者无需 Cloudflare 账号，也无需逐个申请 DNS 记录。
5. 网页登录后连接主 PC，在 Home 的 **Settings → Account Security → Remote access** 核对应用和来源，点击允许。等待超时可在网页重新连接。对会保存数据的 App，完成一次真实任务，退出后用同一账号连回同一主 PC，检查刚保存的结果。普通内容更新沿用原授权，来源或权限声明有实质变化时需要重新确认。

桌面端和网页端可分别发版。回滚网页时，由维护者选回与当前策略兼容的已审核版本。涉及存档格式变化，应先验证旧版能够读取新版已写入的数据。

## Source Basis

- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/platform/remote-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/remote-clients.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`kit/auth/README.md`](https://github.com/nimiplatform/nimi/blob/main/kit/auth/README.md)
- [`examples/remote-runtime-web/README.md`](https://github.com/nimiplatform/nimi/blob/main/examples/remote-runtime-web/README.md)
