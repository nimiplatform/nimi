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

该 validator 检查 canonical tree。规范构建修改了权威文件时，还要对
`.nimi/local/state/spec-generation/spec-generation-audit.yaml` 运行
`pnpm exec nimicoding validate-spec-audit`；缺失或不完整的 audit 必须 fail closed。
两条命令都不创建或更新宿主任务状态。

## 文件所有权

多数 `.nimi/{config,contracts,methodology}/**` 文件以软件包为准。Nimi 只持有三处
宿主专用内容：`.nimi/config/spec-generation-inputs.yaml`、
`.nimi/contracts/domain-admission.schema.yaml` 与
`.nimi/methodology/spec-reconstruction.yaml`。同步时会保留这些已声明差异。

## 来源依据

- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
- [`.nimi/config/bootstrap.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/bootstrap.yaml)
- [`.nimi/config/spec-generation-inputs.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/spec-generation-inputs.yaml)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
