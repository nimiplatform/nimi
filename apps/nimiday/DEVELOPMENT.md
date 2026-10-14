# NimiDay 开发指南

NimiDay 是基于 Nimi 平台构建的生活助手与日程关怀应用，依赖由 Nimi 主仓统一编排管理。

## 快速开始

在仓库根目录下安装依赖，并在两个独立终端中分别启动底层运行时与桌面端：

```sh
pnpm install --frozen-lockfile

# 终端 1：启动 Runtime
pnpm dev:runtime

# 终端 2：启动 Nimi 桌面端（Home）
pnpm dev:desktop
```

待 Nimi 桌面端（Home）就绪后，在第三个终端启动 NimiDay：

```sh
# 查看已有注册实例
pnpm dev:nimiday -- --list-registrations

# 续接指定实例启动
pnpm dev:nimiday -- --resume <selector>
```

首次运行且尚无注册实例时，直接执行 `pnpm dev:nimiday` 即可完成初始化注册。

## 常用开发命令

在仓库根目录执行以下检查与构建命令：

```sh
# 类型检查
pnpm --filter @nimiplatform/nimiday typecheck

# 单元测试与组件测试
pnpm --filter @nimiplatform/nimiday test

# 生产构建验证
pnpm --filter @nimiplatform/nimiday build
```

## 调试提示与端口配置

- 默认 CDP 调试端口为 `9338`，可通过 `--cdp-port <port>` 参数自定义。
- 若需关闭 CDP 调试，可附加 `--no-cdp` 参数启动。
- 本地开发建议通过 `--resume` 续接原有注册实例，以保持测试日程、任务与生活关怀记录的连续性。
