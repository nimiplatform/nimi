# Mod 开发指南

在任何独立 Mod 仓库中构建桌面 Mod 时，请参照本指南。

## 开发契约

- Mod 通过 `nimi-hook` 在桌面沙盒内运行
- Mod 不直接调用 runtime/realm
- Runtime 和 realm 的能力通过已批准的 Hook 接口暴露

## 本地开发

```bash
# 创建脚手架
pnpm dlx @nimiplatform/dev-tools nimi-mod create --dir my-mod --name "My Mod"

# 进入 Mod 目录
cd my-mod
pnpm install
pnpm dev
```

然后在 Desktop 中操作：

1. 打开 `Settings > Mod Developer`
2. 启用 `Developer Mode`
3. 将你的 Mod 目录添加为 `dev` 来源
4. 根据需要启用 `Auto Reload`
5. 在同一面板中查看诊断信息和重载结果

Desktop 侧的开发应仅涉及 UI。`NIMI_RUNTIME_MODS_DIR` 仅保留用于 CI 和内部兼容性，不作为主要的第三方开发流程。

推荐工具链：

- 在本 monorepo 内：调用 [`dev-tools/bin/nimi-mod.mjs`](../../dev-tools/bin/nimi-mod.mjs)
- 在本 monorepo 外：`pnpm add -D @nimiplatform/dev-tools` 并使用发布的 `nimi-mod` CLI

## 验证

```bash
pnpm build
pnpm doctor
pnpm pack
```

如需可运行的 Mod 仓库模板，请参考 [`examples/mod-template`](../../examples/mod-template)。

如需使用 `setModSdkHost()`、`createHookClient()` 和 `createModRuntimeClient()` 的 Mod SDK 示例，请参考 [`examples/mods/mod-basic.ts`](../../examples/mods/mod-basic.ts)。

如需了解正式发布流程、目录发布和第三方上架审核，请参阅 [Mod 发布与提交指南](./release.md)。
