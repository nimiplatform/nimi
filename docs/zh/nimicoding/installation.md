# Nimi Coding Host 集成

Nimi workspace 将 `@nimiplatform/nimi-coding@0.5.0` 固定为精确的
development dependency。正常安装 workspace 后即可使用 CLI：

```bash
pnpm install
```

## 验证受管集成

```bash
pnpm nimicoding:sync
pnpm nimicoding:doctor
```

本仓库中的 `nimicoding:sync` 执行 `sync --check`；它只核验受管文件，不会
改写产品 authority 或宿主任务状态。

## 验证产品 Authority

```bash
pnpm spec:authority:check
pnpm spec:authority:compile
pnpm spec:authority:audit
```

修改 authority 时，必须遵守 `.nimi/methodology/authority-authoring.yaml`：
先获取有界 context，使用带显式 budget 的 semantic diff 与 impact，逐个格式化
changed authority file，最后检查完整 `.nimi/spec` 输入集。

Configured audit 只评价 `.nimi/config/authority-verifiers.yaml` 中的显式绑定；
blocking clear 不表示业务语义完备或 implementation conformance 已通过。

## 文件位置

Nimi Coding host configuration 放在 `.nimi/config/**`。受管 authoring guide
继续放在 `.nimi/methodology/**`。根 `config/**` 适合产品 schema、生成器输入
和实现投影；引用 canonical authority ID 不会让它变成 Nimi Coding 配置，也不
会让它成为第二套 authority。

## 来源依据

- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
- [`.nimi/methodology/authority-authoring.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-authoring.yaml)
