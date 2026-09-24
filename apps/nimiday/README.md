# NimiDay

NimiDay 是 Nimi 主仓内维护的 App，围绕生活事项、照看对象与例行组织用户委托，由用户任命的 Runtime LocalAgent 执行。

## 工程与运行

依赖由仓库根目录的 `pnpm-workspace.yaml` 与 `pnpm-lock.yaml` 统一维护。SDK、Kit、App Tools 使用 `workspace:*`；在根目录运行 `pnpm install --frozen-lockfile`。不在本目录独立安装或执行 scaffold init/sync。

先启动主仓正式开发环境：

```sh
pnpm dev:runtime
# 在另一个终端运行
pnpm dev:desktop
```

Home 就绪后，在根目录选择并续接已有注册：

```sh
pnpm dev:nimiday -- --list-registrations
pnpm dev:nimiday -- --resume <selector>
```

首次使用且没有已有注册时，运行 `pnpm dev:nimiday`。默认开发 CDP 端口为 9338，可用 `--cdp-port` 覆盖；以启动器实际输出为准。原 App ID、注册与业务数据不随工程归属调整而更换。

## 检查

在根目录运行：

```sh
pnpm --filter @nimiplatform/nimiday typecheck
pnpm --filter @nimiplatform/nimiday test
pnpm --filter @nimiplatform/nimiday build
```

这些入口复用主仓 SDK/Kit 准备和构建锁。产品实现位于 `src/nimiday/`，Electron 宿主位于 `src-electron/`。正式开发仍由 Desktop 监管，不直接打开 Vite 页面替代 App 验收。

## 产品与阶段

用户说明见 [GUIDE.md](GUIDE.md)。本目录不维护独立仓库的发布 workflow、安装锁文件或 Tauri 替代宿主。当前源码验证与此前本地安装包的结果分开记录；这次 workspace 调整不发布或更新已有安装包。

下一阶段重点是个人 Agent 的共同能力：持续目标、工具与执行环境、等待与唤醒、按真实结果验收，再完善工作/生活方向。当前已有功能不代表这套通用能力已经全部实现。
