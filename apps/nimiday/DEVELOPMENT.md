# NimiDay 开发指南

NimiDay 是基于 Nimi 平台构建的生活助手与日程关怀应用，依赖由 Nimi 主仓统一编排管理。

## 快速开始

在仓库根目录下安装依赖并启动配套服务：

```sh
# 启动依赖服务
pnpm dev:runtime
pnpm dev:desktop
```

待 Nimi 桌面端（Home）启动就绪后，启动 NimiDay：

```sh
# 查看已有注册实例
pnpm dev:nimiday -- --list-registrations

# 续接指定实例启动
pnpm dev:nimiday -- --resume <selector>
```

首次运行可直接执行 `pnpm dev:nimiday` 进行初始化注册。

## 常用开发命令

在仓库根目录执行以下检查与测试命令：

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
- 若需关闭 CDP 调试直接启动，可附加 `--no-cdp` 参数。
- 本地开发建议通过 `--resume` 续接原注册实例，以确保本地测试日程、任务与生活关怀记录的连续性。
