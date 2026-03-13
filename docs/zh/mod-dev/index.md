# Mod 开发者概览

Nimi Mod 是一种打包后的扩展，加载到 Nimi Desktop 应用中运行。Mod 在基于 Hook 的沙盒化 runtime（`nimi-hook`）内执行，无需直接访问底层 runtime 或 realm 服务即可扩展桌面体验。所有能力均通过已批准的 Hook 接口进行中介。

## 开发契约

- Mod 通过 `nimi-hook` 在桌面沙盒内运行。
- Mod **不直接**调用 runtime 或 realm。
- 能力仅通过已批准的 Hook 接口暴露。
- 从 `@nimiplatform/sdk/mod` 导入，而非 `@nimiplatform/sdk/runtime`。

## 快速上手

### 1. 创建新 Mod

```bash
pnpm dlx @nimiplatform/dev-tools nimi-mod create --dir my-mod --name "My Mod"
```

### 2. 开发

```bash
cd my-mod && pnpm install && pnpm dev
```

### 3. 在 Desktop 中加载

打开 Nimi Desktop 应用，导航至 **Settings > Mod Developer > Add directory**，将路径指向你的 Mod 根目录。

### 4. 验证并打包

```bash
pnpm build && pnpm doctor && pnpm pack
```

`pnpm doctor` 会在分发前检查清单正确性、Hook 兼容性和沙盒合规性。

## 后续步骤

- [开发指南](./guide.md) -- 完整的开发工作流
- [发布与提交](./release.md) -- 发布和目录上架流程
- [发布指南（中文）](./release_cn.md) -- 中文版本
