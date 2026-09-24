# NimiDay 开发

NimiDay 由 Nimi 主仓的 pnpm workspace 统一维护，具体入口见 [README](README.md)。在仓库根目录安装依赖、运行 `pnpm dev:runtime` 与 `pnpm dev:desktop`，然后枚举并 resume 原 Day 注册。

```sh
pnpm dev:nimiday -- --list-registrations
pnpm dev:nimiday -- --resume <selector>
pnpm --filter @nimiplatform/nimiday typecheck
pnpm --filter @nimiplatform/nimiday typecheck:test
pnpm --filter @nimiplatform/nimiday test
```

SDK、Kit 与 App Tools 直接消费根 workspace 的受控构建产物；不再切换“源码模式/候选包模式”，也不复制 `.nimi/local/` 中的历史 pnpm 配置。`test:app` 和 `typecheck:*:prepared` 是依赖准备完成后的局部检查入口。

若 Home 曾在无 CDP 模式下托管启动 Day，当前运行可能与 launcher 的 CDP 配置不同。先确认 Day 没有正在执行的任务或未保存草稿，再按当前注册以 `--no-cdp` 附着并正常退出，随后使用所需 CDP 配置 resume。不要创建另一个注册替代原数据。

桌面运行记录和历史安装包保存在 `.nimi/local/`，不进入 Git。旧安装包不因源码变更而自动更新。未来安装包的构建与发布随主仓 App 的明确交付方案进行，不沿用已删除的独立项目 workflow。
