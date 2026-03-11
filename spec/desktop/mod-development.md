# Mod Development Host

> Normative Imports: `spec/desktop/kernel/*`

## Scope

Desktop 作为第三方 mod 开发与测试宿主的产品约束与用户路径。

## Module Map

- `features/mods/` — 已解析 mod 的运行态入口
- `features/mod-hub/` — 安装、更新、卸载入口
- `settings / developer` — Developer Mode、dev source directories、冲突排障入口

## Kernel References

### Mod Governance (D-MOD-012 — D-MOD-015)

- Desktop 是 zero-bundle mod host，不得内置特定 mod。
- mod source directories 必须显式注册，不得扫描仓路径猜测输入。
- installed mod 目录固定为 `{nimi_data_dir}/mods`；用户只能添加 `dev` source。
- `mod id` 在所有已启用 source 中必须全局唯一；重复时 fail-close。
- 第三方作者在 Desktop 侧的主流程必须是 UI-only。

### IPC (D-IPC-013)

- source registry、`nimi_data_dir`、developer mode、reload 和 diagnostics 通过受管 IPC 暴露。

### Shell (D-SHELL-009, D-SHELL-010)

- Developer Mode 必须在 App 内可配置。
- Mods Panel / Developer Panel 必须可见 mod 的来源目录、source type 和冲突状态。
- Mod Hub 不是主调试入口。

## CI 门禁引用

本域目前依赖 `pnpm check:desktop-spec-kernel-consistency` 与 `pnpm check:desktop-spec-kernel-docs-drift` 保持规则与文档一致。实现级门禁待 Developer Host UI 和 IPC 落地后补齐。
