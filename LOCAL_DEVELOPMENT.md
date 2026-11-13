# Nimi 本地开发指南 (Local Development)

本文档面向在 Windows 与 macOS 环境下进行 Nimi Desktop、本地 Runtime 及生态应用开发的开发者，介绍核心工作流、调试手段与安全规范。

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
| `pnpm dev:desktop` | Windows / macOS Home 与 Runtime 源码迭代 | 默认官方 Realm；无需 Realm 私有仓库或本地数据库 |
| `pnpm dev:desktop -- --realm local` | Realm 与 Nimi 联调 | 显式本地 Realm；复用或按配置启动 API、Realtime、登录页 |
| `pnpm dev:runtime` | Windows x64 / macOS arm64 本地 Runtime 源码调试 | 独立终端持续前台运行 |
| `pnpm dev:lab` | 启动 Nimi Lab 能力测试台应用 | 需先启动并登录 Desktop |
| `pnpm dev:zhiyu` | 启动 织羽 (Zhiyu) AI 伙伴应用 | 需先启动并登录 Desktop |
| `pnpm dev:nimigo` | 启动 NimiGo 应用 | 需先启动并登录 Desktop |
| `pnpm dev:nimiday` | 启动 NimiDay 应用 | 需先启动并登录 Desktop |
| `pnpm dev:avatar` | 启动独立的桌面 Avatar 悬浮载体 | 与普通 `pnpm dev:desktop` 互斥 |
| `nimi-app dev --shell electron` | 启动第三方生态应用工程 | 默认由已安装 Nimi 监督启动 |

---

## Web 与 Android 消费端

本页的 Electron/CDP 和原生 Host 命令仅适用于本机原生开发。Web 应用通过已准入的 HTTPS 来源与官方登录直连主 Runtime，见 [Web 指南](docs/zh/start/connect-web-app.md)；Android 应用使用 Kit Capacitor 和 App 自身的原生工程接入，见 [Android 指南](docs/zh/start/connect-android-app.md)。这两类接入都需要使用相互匹配的源码制品，请勿借用 Desktop 登记的 selector 伪造原生会话。

## CDP 调试端口分配

为了方便开发者进行自动化验收与 UI 调试，根目录下的各应用启动命令默认开启仅监听本地 `127.0.0.1` 的 Chrome DevTools Protocol (CDP)：

- **Nimi Desktop**：`9333`
- **Zhiyu**：`9334`
- **Nimi Lab**：`9335`
- **Avatar**：`9336`
- **NimiGo**：`9337`
- **NimiDay**：`9338`

### 自定义与关闭 CDP 端口
- 指定端口：`pnpm dev:lab --cdp-port 19468`
- 关闭 CDP：`pnpm dev:desktop --no-cdp`

> **提示**：若默认端口被占用，启动将明确报错中断，系统不会随机切换其他端口，确保调试配置的可预测性。第三方 App 使用 `nimi-app dev` 时默认动态分配端口，并在控制台打印输出。

---

## 推荐的开发流程

### 平台通用步骤
1. **选择开发对象**：普通生态开发使用已安装 Nimi；修改 Nimi 本体时准备公开仓库依赖即可。两者默认连接官方真实 Realm。
2. **启动 Nimi**：本体开发运行 `pnpm dev:desktop`，启动器准备源码 Runtime 和 Electron，不启动本地 Realm 或官网登录页。需要全链联调才加 `--realm local`；此时可用 `NIMI_DEV_REALM_DIR` 指定有 `dev:infra`、`dev:api`、`dev:realtime` 的 Realm 工作区，或复用已运行服务。
3. **完成登录与授权**：首次启动 Desktop 时，选择数据根目录，并通过浏览器完成 Nimi 账号登录。
4. **启动目标生态应用**：`pnpm dev` / `nimi-app dev` 使用当前运行的 Home。普通开发先打开已安装 Nimi；源码联调先退出安装版 Runtime，再启动源码 Nimi。App 命令不启动或替换 Runtime。

Realm 启动位置是本机配置。使用自动启动时，Realm 的 `dev:infra` 负责准备其开发配置所需的数据服务。Docker、开发镜像或数据库未就绪时，按对应 Realm 工作区的开发说明处理。

本地模式的 API/Realtime 默认 `127.0.0.1:3002/3003`，登录 Web 默认 `localhost:3000`。可用 `NIMI_DEV_REALM_URL`、`NIMI_DEV_REALTIME_URL`、`NIMI_DEV_WEB_URL`、`NIMI_DEV_REALM_ENVIRONMENT_ID` 配置该本地部署。官方模式不使用这些本地覆盖值。端口或工作区冲突明确报错；日志位于 `.nimi/local/dev-services/`。源码 Runtime 仍由 supervisor 启动并通过原生准入。

同一机器只运行一个 Runtime；启动第二个时，无论 installed 还是 source，都会明确报错。切换版本或 Realm 前先正常退出当前 Runtime。兼容版本可以顺序复用同一个数据目录（包括模型和引擎），开发不要求复制这些大文件。Realm 凭据和持久身份仍按环境保管，不自动迁移或替换主绑定。同一官方账户共享真实云端数据。`pnpm doctor:dev -- --realm local` 诊断选定环境，`--host installed` 可检查安装版目标。

关闭 Desktop 或终端中断启动时，只停止本次自动创建的开发进程；先前已运行的服务和数据容器保留。需要独立调试 Runtime 时仍可先运行 `pnpm dev:runtime`，Desktop 会复用它。`pnpm dev:electron:desktop` 和 Desktop 包内的 `dev` / `dev:electron` 使用同一依赖检查。

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

完成日常功能迭代后，建议依次执行以下检查：

1. **类型检查与测试**：
   ```bash
   pnpm run typecheck
   pnpm run test
   ```
2. **打包与生产环境一致性校验**：
   ```bash
   pnpm exec nimi-app check --production
   pnpm exec nimi-app build --target macos-aarch64 --production
   pnpm exec nimi-app pack --target macos-aarch64 --production
   ```
   以上命令以 Apple Silicon Mac（`macos-aarch64`）为例；在 Windows 主机上请将 `--target` 改为 `windows-x86_64`。日常验证本地归档依赖时使用普通 `check` / `build` 即可，正式公开发布前再使用 `check --production` 进行预检。
3. **全流程联调测试**：在真实 Desktop 中完成从「应用启动 → 访问就绪 → AI 响应 → 状态保存 → 重启恢复」的闭环验证。
