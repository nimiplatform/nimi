# Nimi Host 集成

Nimi 仓库把 `@nimiplatform/nimi-coding` 固定为 development dependency，并通过
受保护的宿主边界使用它。正常安装会带入软件包；项目命令负责核验已审计版本和
受管文件。

## 前置要求

| 要求 | 用途 |
| --- | --- |
| Node.js 24 或更新 | Workspace runtime |
| pnpm | 仓库 package manager |
| Nimi Git checkout | 提供已准入 host projections 与 wrappers |
| Codex 或其他已准入外部宿主 | 持有任务执行 |

## 安装 Workspace Dependencies

```bash
pnpm install
```

不要在本仓库直接运行通用 bootstrap 或 clear 命令。需要刷新受管文件时，只使用
package.json 中声明的项目命令，让宿主边界先完成检查。

## 验证集成

```bash
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

两项检查都必须通过。`sync --check` 核验 package-canonical 文件和必备的 host-owned
seed，宿主自有内容不会被误判为包漂移。

## 验证产品权威

```bash
pnpm exec nimicoding validate-spec-tree .nimi/spec
```

Authority 编辑需要对每个 changed container 运行仓库管理的 format 命令，
随后运行 `pnpm spec:authority:check` 与 `pnpm spec:authority:compile`。
这些命令验证 authority，但不创建或更新宿主任务状态。

## 文件所有权

多数 `.nimi/{config,contracts,methodology}/**` 文件以软件包为准。仓库专用的
methodology 与 contract 是 host configuration，不是产品 authority。

## 来源依据

- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
- [`.nimi/config/bootstrap.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/bootstrap.yaml)
