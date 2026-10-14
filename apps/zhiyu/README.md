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
