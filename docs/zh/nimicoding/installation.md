# Nimi Host 集成

Nimi 仓库把 `@nimiplatform/nimi-coding` 固定为 development dependency，并通过
host compatibility 边界消费它。正常 workspace install 提供软件包；项目 wrappers
验证 Nimi 自有投影保持完整。

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

不要用通用 package 命令 bootstrap 或改写 `.nimi/**`。Nimi 已持有自己的 host
projections；forbidden package projection 一旦出现，门禁会 fail closed。

## 验证集成

```bash
pnpm check:nimicoding-host-hardcut
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

三项检查都必须通过。Compatibility wrapper 强制 declared absent projection 集合
与精确 Nimi-owned overrides；其他 drift 仍然失败。

## 验证产品权威

```bash
pnpm exec nimicoding validate-spec-tree .nimi/spec
```

该 validator 检查 canonical tree。当前任务确实执行 `spec_reconstruction` 时，还要对
声明的本地 audit artifact 运行 `pnpm exec nimicoding validate-spec-audit`；必备 audit
缺失必须 fail closed。两条命令都不创建或更新宿主任务状态。

## Skill 可用性

`.nimi/config/skill-manifest.yaml` 声明三个外部 skills：`spec_reconstruction`、
`doc_spec_audit` 与 `audit_sweep`。当前宿主直接读取 inputs 与 result contracts。

## 来源依据

- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
- [`config/nimicoding-host-hardcut.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/nimicoding-host-hardcut.yaml)
- [`.nimi/config/skill-manifest.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/skill-manifest.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
