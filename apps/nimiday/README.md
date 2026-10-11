# NimiDay

NimiDay 是基于 Nimi 平台构建的生活助手与日程关怀应用。用户可指派专属 AI 角色作为日常伴侣，协同安排生活日程、重要事件提醒、健康关怀与日常事务规划，由 Runtime 本地智能体（LocalAgent）在安全受控环境中执行。

## 开发与运行

项目作为 Nimi 整体 Monorepo 的一部分，依赖由根目录的 `pnpm-workspace.yaml` 与 `pnpm-lock.yaml` 统一管理。SDK、Kit 与 App Tools 均以 `workspace:*` 方式引用。在仓库根目录执行 `pnpm install --frozen-lockfile` 即可完成依赖安装。

### 启动步骤

1. **启动基础运行时与桌面外壳**：
   在仓库根目录分别启动底层服务：
   ```sh
   # 终端 1
   pnpm dev:runtime

   # 终端 2
   pnpm dev:desktop
   ```

2. **启动 NimiDay**：
   待 Nimi 桌面端（Home）就绪后，在根目录启动或续接已有注册实例：
   ```sh
   # 查看当前已注册的应用实例
   pnpm dev:nimiday -- --list-registrations

   # 续接指定实例启动
   pnpm dev:nimiday -- --resume <selector>
   ```

首次运行且未有注册实例时，直接运行 `pnpm dev:nimiday` 即可。默认开发调试端口为 `9338`（可通过 `--cdp-port <port>` 覆盖）。

## 质量验证与构建

在仓库根目录运行对应的校验脚本：

```sh
# 类型检查
pnpm --filter @nimiplatform/nimiday typecheck

# 单元与集成测试
pnpm --filter @nimiplatform/nimiday test

# 生产构建
pnpm --filter @nimiplatform/nimiday build
```

## 目录结构与架构

- `src/nimiday/`：应用的核心业务逻辑、生活事件流与日程管理界面
- `src-electron/`：Electron 宿主进程实现，负责窗口生命周期与安全沙箱桥接
- `GUIDE.md`：面向最终用户的功能使用指南与操作说明
- `DEVELOPMENT.md`：针对开发者的调试指南与环境配置说明
