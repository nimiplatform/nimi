# Nimi 本地开发指南 (Local Development)

本文档面向在 Windows 与 macOS 环境下进行 Nimi Desktop、本地 Runtime 及生态应用开发的开发者，介绍核心工作流、调试手段与安全规范。

---

## 核心设计与安全模型

本地开发时，应用通过受保护的宿主会话访问 Nimi 能力，遵循四项核心原则：

- **桌面宿主监督**：生态应用均由 Nimi Desktop 作为 Supervisor 监督启动，运行在独立的 Electron 宿主中。
- **受控安全信道**：应用通过 Kit 标准 Bridge 与 Runtime 通信；前端渲染层**绝不直接持有**敏感 Token、系统 RPC 端点或底层凭据。
- **确定性错误反馈**：通信断开或未获授权时，接口会返回结构化错误码，严禁静默吞错或伪造成功状态。
- **权限解耦**：开发者模式（Developer Mode）仅负责开启本地联调通道，具体的数据与 AI 能力调用仍由运行时权限系统按需鉴权。

---

## 开发路径与命令矩阵

| 开发路径 | 适用场景 | 依赖条件 |
|---|---|---|
| `pnpm dev:desktop` | Windows / macOS 桌面端 UI、Main 与 Preload 核心迭代 | 先在独立终端启动 `pnpm dev:runtime` |
| `pnpm dev:runtime` | Windows x64 / macOS arm64 本地 Runtime 源码调试 | 独立终端持续前台运行 |
| `pnpm dev:lab` | 启动 Nimi Lab 能力测试台应用 | 需先启动并登录 Desktop |
| `pnpm dev:zhiyu` | 启动 织羽 (Zhiyu) AI 伙伴应用 | 需先启动并登录 Desktop |
| `pnpm dev:nimigo` | 启动 NimiGo 应用 | 需先启动并登录 Desktop |
| `pnpm dev:nimiday` | 启动 NimiDay 应用 | 需先启动并登录 Desktop |
| `pnpm dev:avatar` | 启动独立的桌面 Avatar 悬浮载体 | 与普通 `pnpm dev:desktop` 互斥 |
| `nimi-app dev --shell electron` | 启动第三方生态应用工程 | 由 Desktop supervisor 监督启动 |

---

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
1. **启动 Runtime 守护进程**：在一个终端窗口运行 `pnpm dev:runtime`，保持该终端处于前台运行状态。
2. **启动 Nimi Desktop**：在另一个终端运行 `pnpm dev:desktop`。
3. **完成登录与授权**：首次启动 Desktop 时，选择数据根目录，并通过浏览器完成 Nimi 账号登录。
4. **启动目标生态应用**：在 Desktop 保持运行的前提下，在新的终端窗口启动对应应用（如 `pnpm dev:zhiyu`，或在第三方 App 目录下运行 `pnpm dev`）。

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
