# 织羽

中文名：织羽。英文名：Zhiyu。

织羽是 Nimi 中的本地伙伴体验中心，通过受保护的 App 会话与当前伙伴交互。伙伴身份、对话和记忆由各自的系统管理，织羽负责呈现与操作入口。

## 开发前提

先按 [LOCAL_DEVELOPMENT.md](../../LOCAL_DEVELOPMENT.md) 准备 Node/pnpm、源码 Realm/Web 和系统依赖。从 Nimi 仓库根目录安装工作区依赖，再启动 Runtime 和 Nimi Home：

```sh
pnpm install
```

在两个独立终端中分别运行：

```sh
# 终端 1
pnpm dev:runtime

# 终端 2
pnpm dev:desktop
```

Nimi Home 启动后，在浏览器中完成登录。织羽需要 Desktop supervisor 和有效的 App 会话；仅启动渲染器无法满足这些条件。

## 启动织羽

保持 Runtime 与 Home 运行，在第三个终端执行：

```sh
pnpm dev:zhiyu
```

该入口准备工作区 SDK/Kit，并通过 Desktop 启动织羽的 Electron 开发宿主。也可在依赖与宿主已就绪时使用 `pnpm --filter @nimiplatform/zhiyu dev`。

只调试前端布局时可运行：

```sh
pnpm --filter @nimiplatform/zhiyu dev:renderer
```

这是渲染器调试入口，不建立正式 App 会话，也不能用于验证伙伴对话、语音或 Avatar 的产品路径。完整环境步骤见 [LOCAL_DEVELOPMENT.md](../../LOCAL_DEVELOPMENT.md)。
