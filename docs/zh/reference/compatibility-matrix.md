# 兼容性矩阵

在升级生产系统前请参照此矩阵。

| 层级 | 兼容性规则 |
|---|---|
| SDK vs Dev Tools | 保持完全相同的语义化版本号（`X.Y.Z`） |
| SDK vs Runtime | 保持在相同的 `major.minor` 版本线内 |
| SDK vs Desktop/Web | 每个应用发布版本绑定固定的 workspace 发布集合 |
| Proto vs Runtime | 不支持 Proto 契约漂移 |

## 验证命令

```bash
pnpm check:sdk-version-matrix
pnpm check:runtime-bridge-method-drift
pnpm check:scope-catalog-drift
```
