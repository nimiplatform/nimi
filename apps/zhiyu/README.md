[App introduction and usage](NIMI_APP.md)

# 织羽

中文名：织羽。英文名：Zhiyu。

织羽是 Nimi 中的本地伙伴体验中心，通过受保护的 App 会话与当前伙伴交互。伙伴的身份、对话和长期记忆由各自所属的系统组件管理，织羽专注于交互呈现与操作入口。

## 开发前提

请先参照 [LOCAL_DEVELOPMENT.md](../../LOCAL_DEVELOPMENT.md) 准备好 Node/pnpm、源码 Realm/Web 及系统依赖。先在 Nimi 仓库根目录安装工作区依赖：

```sh
pnpm install
```

随后在两个独立终端中分别启动 Runtime 和 Nimi Home：

```sh
# 终端 1
pnpm dev:runtime

# 终端 2
pnpm dev:desktop
```

待 Nimi Home 启动后，在浏览器中完成登录。织羽依赖 Desktop supervisor 托管与有效的 App 会话，仅启动前端渲染器无法满足正式运行条件。

## 启动织羽

保持 Runtime 与 Nimi Home 运行，在第三个终端执行：

```sh
pnpm dev:zhiyu
```

该命令会先准备工作区中的 SDK 与 Kit，再通过 Desktop 拉起织羽的 Electron 开发宿主。若依赖与宿主均已就绪，也可直接运行 `pnpm --filter @nimiplatform/zhiyu dev`。

如果仅需调试纯前端布局，可运行：

```sh
pnpm --filter @nimiplatform/zhiyu dev:renderer
```

注意：`dev:renderer` 仅用于界面布局预览，不会建立受保护的 App 会话，不能用于验证伙伴对话、语音或 Avatar 等实际产品链路。完整环境配置说明见 [LOCAL_DEVELOPMENT.md](../../LOCAL_DEVELOPMENT.md)。


## 本机 Web 开发入口

源码分支已增加 `pnpm --filter @nimiplatform/zhiyu dev:web`，由 App Tools 的 Web 载体启动。`nimi.app.yaml` 的 `local_development.web` 声明精确来源／回调与官方登录地址；TLS 文件路径在未提交的 `.env.web.local` 中配置。当前本机来源为 `https://127.0.0.1:4472`。来源需要 Registry 接纳和 PC Home 一次确认；正常重连与开发迭代复用许可。

Web 与 Electron 共用 canonical renderer、伙伴列表、Conversation、伙伴配置和资源包呈现。浏览器通过同一 SDK／Kit 连接当前账号的主 Runtime，不安装原生 bridge，也不把网页当作本机 Host。Resource Pack 使用浏览器选文件，沿用原预览、手动应用、Runtime 保存和重读流程。跨来源 App 私有文件不自动合并；当前伙伴的 canonical Conversation 与 presentation 由 Runtime 管理。

当前已实际运行文本聊天、读取原会话、伙伴配置投影、皮肤预览／应用／清除及重连后的原结果读取。原生 Avatar 启动与原生 placement 仍属于原生 Host；其它语音／媒体组合及物理外网条件不能据此视为已验收。`zhiyu.nimi.ai` 尚未在本轮部署或发布。

上述原生开发章节仍适用于 Electron。Web 构建可使用 `build:web`，只产生网页资源，不等于部署或 Runtime 调用通过。
