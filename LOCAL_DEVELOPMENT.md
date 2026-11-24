# Nimi 本地开发指南 (Local Development)

普通原生 App 开发默认使用已安装的 Nimi 连接官方 Realm；修改 Home、Runtime、SDK 或 Kit 时，可用公开仓库的源码 Runtime 对接官方 Realm；只有联调 Realm 服务或需要受控测试数据时，才显式选择 `local`。注意，官方账号会读写真实云端数据。无论走哪条路径，开始前都先确认本机是否已有满足当前任务的 Home 和 Runtime。

[按任务选择入口](#开发路径与命令矩阵) · [判断能否复用](#先判断能否复用) · [切换对身份和数据的影响](#切换会影响什么)

---

## 核心设计与安全模型

本地开发时，应用通过受保护的宿主会话访问 Nimi 能力，遵循四项核心原则：

- **桌面宿主监督**：本机原生生态应用由 Nimi Desktop 作为 Supervisor 监督启动，运行在独立的 Electron 宿主中。获准的 Web 和 Android 客户端通过远程 SDK 直连主 Runtime，不受本机 Electron supervisor 托管。
- **受控安全信道**：本机原生 App 通过 Kit 标准 Bridge 接入；Web/Android 使用公共 SDK 的直连通道。远程客户端持有受限的当前接入上下文，不取得通用账号凭据或模型服务密钥。
- **确定性错误反馈**：通信断开或未获授权时，接口会返回结构化错误码，严禁静默吞错或伪造成功状态。
- **权限解耦**：开发者模式（Developer Mode）仅负责开启本地联调通道，具体的数据与 AI 能力调用仍由运行时权限系统按需鉴权。

---

## 开发路径与命令矩阵

| 开发路径 | 适用场景 | 依赖条件 |
|---|---|---|
| `pnpm dev:desktop` | Windows / macOS Home、Runtime、SDK 或 Kit 源码联调 | 默认官方 Realm，只需公开仓库和本机工具链 |
| `pnpm dev:desktop -- --realm local` | Realm 与 Nimi 联调 | 显式本地 Realm；复用或按配置启动 API、Realtime、登录页 |
| `pnpm dev:runtime` | Windows x64 / macOS arm64 本地 Runtime 源码调试 | 独立终端持续前台运行 |
| `pnpm dev:lab` | 启动 Nimi Lab 能力测试台应用 | 需先启动并登录 Desktop |
| `pnpm dev:zhiyu` | 启动 织羽 (Zhiyu) AI 伙伴应用 | 需先启动并登录 Desktop |
| `pnpm dev:harness` | 启动 Nimi Harness 智能助理与 PC 工作台 | 需先启动并登录 Desktop |
| `pnpm dev:avatar` | 启动独立的桌面 Avatar 悬浮载体 | 与普通 `pnpm dev:desktop` 互斥 |
| `pnpm dev` / `nimi-app dev --shell electron`（App 工程内） | 启动第三方原生 App | 使用当前已登录并开启 Developer Mode 的匹配 Home |

---

## Web 与 Android 消费端

本页的 Electron/CDP 和原生 Host 命令仅适用于本机原生开发。Web 应用通过已准入的 HTTPS 来源与官方登录直连主 Runtime，见 [Web 指南](docs/zh/start/connect-web-app.md)；Android 应用使用 Kit Capacitor 和 App 自身的原生工程接入，见 [Android 指南](docs/zh/start/connect-android-app.md)。这两类接入都需要使用相互匹配的源码制品，请勿借用 Desktop 登记的 selector 伪造原生会话。

## CDP 调试端口分配

为了方便开发者进行自动化验收与 UI 调试，根目录下的各应用启动命令默认开启仅监听本地 `127.0.0.1` 的 Chrome DevTools Protocol (CDP)：

- **Nimi Desktop**：`9333`
- **Zhiyu**：`9334`
- **Nimi Lab**：`9335`
- **Avatar**：`9336`
- **Nimi Harness**：`9337`

### 自定义与关闭 CDP 端口
- 指定端口：`pnpm dev:lab --cdp-port 19468`
- 关闭 CDP：`pnpm dev:desktop --no-cdp`

> **提示**：若默认端口被占用，启动将明确报错中断，系统不会随机切换其他端口，确保调试配置的可预测性。第三方 App 使用 `nimi-app dev` 时默认动态分配端口，并在控制台打印输出。

---

## 推荐的开发流程

### 先判断能否复用

在公开 Nimi 仓库根目录按本次任务选择一条只读诊断。独立 App 开发者可以直接在已运行的 Home 确认环境和登录账号。

```sh
pnpm doctor:dev -- --host installed --realm official
pnpm doctor:dev -- --host source --realm official
pnpm doctor:dev -- --host source --realm local
```

重点对照 `Requested Runtime` 和 `Observed Runtime`。源码启动器与诊断命令比对的是同一组公开配置，包括 Realm 名称、API、Realtime、登录页地址以及配置的环境 ID。运行中的 supervisor 会报告自己的选择；若旧的 local 进程缺少这些信息，先核对启动它的终端。服务端实际签发的环境 ID 与账号，则要在登录后核对。

脚本可从 `--json` 输出中读取 `requested`、`observed` 和 `reuse.state`。另需注意：HTTP 检查只表示请求地址可达，SDK/Kit 工作区产物只影响源码目标的检查。

| Runtime reuse | 下一步 |
|---|---|
| `reusable` | 当前工作区的源码 Runtime 与请求的 Realm 配置匹配。已有 Home 就在该窗口继续；只有 Runtime 在运行时，用相同 Realm 参数启动 Home。要验证刚改过的 Runtime 代码，仍须协调重启以加载新二进制。 |
| `conflict` | 已探测到不兼容的目标。需要当前环境的其他任务可以照常继续。确实需要新目标时，与启动者约定切换时间。 |
| `unknown` | 看原因。没有活动源码 Runtime 时可按任务启动；正在启动、无法读取进程或固定服务未给出 Realm 时，先查看所属终端和 Home。 |

更新依赖后，在仓库根目录运行 `pnpm install --frozen-lockfile`。需要在启动 Home 前准备 SDK 与 Kit 时，运行 `pnpm dev:prepare`；它使用与源码启动器相同的构建和产物检查。

源码启动示例是 `pnpm dev:desktop`（默认官方）和 `pnpm dev:desktop -- --realm local`。独立调试 Go 时可先运行 `pnpm dev:runtime`，两条命令选同一 Realm。只有 local 模式会检查 API、Realtime 和本地登录页，默认分别为 `127.0.0.1:3002`、`127.0.0.1:3003` 和 `localhost:3000`。可复用已有服务，或用 `NIMI_DEV_REALM_DIR` 指定提供 `dev:infra`、`dev:api` 和 `dev:realtime` 的工作区。各地址与环境 ID 的覆盖项见 [.env.example](.env.example)。

首次设置 Home 时，需选择数据目录并通过浏览器完成登录。原生 App 在各自工程中运行 `pnpm dev`，由当前活动的 Home 监督启动。需要继续使用既有开发数据时，先运行 `pnpm dev -- --list-registrations`，再用本次列出的 `--resume <selector>`。若本机已有匹配的源码 Home，普通 App 开发也可以直接复用；安装包验证留给安装态任务。

### 切换会影响什么

一台机器同时只运行一个 Runtime。切换前先与使用它的开发者协调，完成或停下进行中的生成、下载和验收。如果 App 终端需要收到停止回执，先在该终端按 `Ctrl+C`，等候 `stopped`。先退出 Home 时，App 终端可能失去连接并报告最终状态未知。

macOS 上，在 `pnpm dev:desktop` 的终端按一次 `Ctrl+C`，启动器会让 Home 关闭受其监督的开发 App，再停止本次启动的 Runtime 和服务。单独用 `pnpm dev:runtime` 启动的 Runtime 由原终端退出。等旧实例退出后再启动新目标。开发服务日志在 `.nimi/local/dev-services/`。

| 状态 | 归属与切回后的行为 |
|---|---|
| Realm 和账号 | Realm 管理云端账号和业务库。Runtime 按操作系统用户在其受保护的状态目录保管当前登录材料，其中记录登录时的 API origin 和 Realm 返回的环境 ID。恢复时 origin 不匹配会尝试清除旧凭据并要求重新登录。 |
| 源码安装身份 | 当前用户的 `RuntimeLocalDevelopment/official`、`RuntimeLocalDevelopment/local` 分别保留 `runtime/installation.json` 的 Runtime ID、Product Control 的 `.nimi/nimi.json`（安装 ID 和 dataRoot 选择）以及开发模式的 `runtime/local-development.db`。**两个不同的 local 部署会选中同一目录**，即使更改 API 地址或 `NIMI_DEV_REALM_ENVIRONMENT_ID`。同一地址背后的部署发生变化时，进程探测也无法识别它。 |
| 主 Runtime 绑定 | Realm 保管账号的主绑定。本机证明密钥按 Product Control 安装 ID、操作系统用户、Realm 环境 ID 和账号 ID 区分。切回原环境需要原绑定和对应密钥仍有效。新环境提示其他主机已绑定时，先核对测试账号。重新初始化会改变 Web、Android 等远程客户端连接的主机。 |
| App 登记、数据与会话 | 当前宿主按安装 ID 与操作系统用户查找登记。Runtime 托管的 App 存储按操作系统用户、账号和登记主体分区。Electron 浏览器配置按安装 ID、操作系统用户和登记主体定位。Runtime 重启后须建立新会话，使用原账号和登记可以继续访问对应的持久数据。App 自管的项目文件按该 App 的保存及打开方式核对。 |
| 模型、引擎与数据库 | 兼容版本可以顺序指向同一个 dataRoot，复用模型与引擎包。源码 Runtime 按持久 Runtime ID 打开 `accounts/source-<runtimeId>/memory.db` 和 `apps/source-<runtimeId>/local-app-kernel.db`，引擎登记也按该 ID 保存。安装态使用 `accounts/runtime/memory.db` 与 `apps/local-app-kernel.db`。文件已在磁盘上，具体环境仍需有可用的模型配置。 |

若启动报告 `unsupported canonical_registration … constraint`，先核对报错的 App 登记库和当前代码要求的表约束。对工具支持的旧格式，`pnpm runtime:repair-app-source-schema --db <数据库绝对路径>` 只读预览。若报 `unsupported LocalAgent source snapshot schema`，受影响的是 Runtime 的 `memory.db`。这些属于数据库版本漂移；重新登录或重设主绑定无法修复表结构。实际修复应针对已确认的库，在停机后执行对应的离线工具。

升级后若提示 `conversation storage requires explicit offline conversion`，停止使用该库的 Runtime，再运行 `pnpm runtime:convert-chat-storage --db <该环境的 memory.db 绝对路径> --confirm-runtime-stopped` 查看是否需要转换。每个环境有自己的库和检查结果。[会话库转换说明](runtime/tools/convert-chat-storage/README.md)

---

## 层次化热重载 (Hot Reload) 与变更响应

在多组件协同开发时，代码变更的响应逻辑如下：

| 修改范围 | 响应行为 | 说明 |
|---|---|---|
| **Desktop Renderer** | Vite HMR | 页面毫秒级局部刷新 |
| **Desktop Main / Preload** | 自动触发重新构建 | 重建后自动重启 Electron 宿主 |
| **第三方 App Renderer** | Vite HMR | 保持在 Supervisor 宿主内热更新 |
| **第三方 App `src-electron`** | 防抖重新构建 | 自动安全替换底层 Electron 宿主 |
| **Runtime Go 核心** | 重启 `pnpm dev:runtime` | 守护进程重新编译并拉起服务 |
| **SDK / Kit 共享库** | 自动 Watch 构建 | Desktop 启动时会自动 watch SDK/Kit，产物新鲜时直接生效 |

---

## 生态应用接入的最小契约

对于第三方或独立 App，工程根目录需满足以下基础规范：

### 1. `nimi.app.yaml` 清单
必须声明唯一的 `app_id`、申请的能力权限列表（Permissions）以及本地渲染服务的 Origin 地址。

### 2. `package.json` 基础脚本
```json
{
  "scripts": {
    "dev": "nimi-app dev --shell electron",
    "dev:shell": "nimi-app dev",
    "dev:renderer": "vite --host 127.0.0.1 --port <manifest-port> --strictPort",
    "build:electron": "vite build --config vite.electron.config.ts"
  }
}
```

### 3. 主进程与 Preload 架构
- **Electron 主进程**：统一通过 `registerNimiElectronAppBridge` 建立安全连接。
- **Preload 预加载层**：使用 Kit 提供的标准 Bridge 暴露安全的 API 接口。
- **Renderer 渲染层**：保持纯前端环境，不直接接触 Node.js 原生 API 或本地文件系统。Nimi 能力调用统一通过 `@nimiplatform/sdk` 完成；应用自身的业务桥接则由应用自行维护。

---

## 验证与发布前检查

日常迭代先做与改动相关的工程检查，再在当前 Home 监督的 App 中完成实际任务。根据本次验证的目标选择下列入口。

1. **工程检查**在 App 工程中运行。
   ```bash
   pnpm run typecheck
   pnpm run test
   ```
2. **开发态联调**使用 `pnpm dev`。在 Home 监督的 App 中检查访问就绪、实际调用和状态保存。验证重启恢复时，重新列出登记再恢复原来的 App 数据。
3. **安装态专项**使用匹配的本地制品和目标平台验证包内容与安装。以下为 Apple Silicon Mac 示例。
   ```bash
   pnpm exec nimi-app check
   pnpm exec nimi-app build --target macos-aarch64
   pnpm exec nimi-app pack --target macos-aarch64 --production
   ```
   Windows x86_64 使用 `--target windows-x86_64`。正式公开发布前，选用从公共 registry 解析的依赖，再执行 `check --production` 与对应目标的 `build --production`。
