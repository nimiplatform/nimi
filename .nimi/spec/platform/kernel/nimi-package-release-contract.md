# Nimi Package Release Contract

> Owner Domain: `P-PKGREL-*`

## Scope

定义 `Nimi` 可安装产品的 package / release / update identity。本契约固定
installable product name、bundle identity、release channel identity、updater
endpoint / pubkey policy、install-gateway handoff scope、failure projection
要求，以及 Nimi self-update、app updates、Runtime local dependency updates
之间的关系。

## P-PKGREL-001 — Installable Product Name

`MUST`：`Nimi` 是 user-facing installable product 的唯一名称。

`MUST NOT`:

- 不得在 user-facing UI、安装包元数据、release manifest、updater channel
  identity、registry schema、或 IPC 命令名中出现 `Desktop` 作为 product
  identity。
- 不得引入 `Launcher` 作为 user-facing product identity；`launcher` 只允许作为
  internal capability category term，不得进入安装包、release、updater、registry、
  IPC、或 user-facing product identity surface。

## P-PKGREL-002 — Atomic Bundle Identity

`MUST`：每个 Nimi 安装/更新 bundle 是单一原子 release unit，至少包含：

- Desktop-host shell binary
- 内嵌 Runtime daemon binary（与 Desktop-host 版本严格绑定）
- 已 admit 的 release metadata（含版本、release channel、signature、
  rollback metadata）

`MUST NOT`：不得通过 hot-patch、partial-replace、out-of-band 替换 Runtime
binary 形成与 Desktop-host 不同步的 release unit。

## P-PKGREL-003 — Release Channel Identity

`MUST`：release channel identity 由本契约配合 `release-gate-registry.yaml`
admit；已 admit channel 固定为 `stable` 与 `beta`。其他 channel 不属于当前
release identity surface。

`MUST NOT`：UI / SDK / app 不得自创 channel 字符串作为产品事实源。

## P-PKGREL-004 — Updater Endpoint And Pubkey Policy

`MUST`：updater endpoint 与 pubkey policy 是 Platform-owned configuration。
pubkey rotation 必须经过本契约显式 admit（含 rotation 信号、grace window、
旧 pubkey 失效条件）。

`MUST NOT`：Desktop builder、Runtime、SDK、app 不得绕过本契约动态注入 / 切
换 updater endpoint 或 pubkey。

## P-PKGREL-005 — Install Gateway Handoff Scope

`MUST`：web install gateway（`P-WEB-*`）admit Nimi 安装包下载、签名 /
pubkey 验证、handoff 给 desktop-host installer 的 scope。

`MUST NOT`：install gateway 不得：

- 执行 Runtime local environment materialization
- 安装 / 更新模型或本地依赖
- 持久化 Runtime selected source record
- mutate user PATH / machine PATH / shell profile / 系统 Python / system
  CUDA / package-manager global state

## P-PKGREL-006 — Failure Projection Requirement

`MUST`：每个 release / update 失败 path 必须暴露显式 Nimi Home projection
（`failed`、`rollback-required`、`verification-failed`、`unsupported`、
`stale-projection` 等）。

`MUST NOT`：不得通过"latest version unavailable"等 generic 字段隐藏失败
原因；fail-closed 状态必须能追溯到具体 reason class。

## P-PKGREL-007 — Three Update Surfaces Are Distinct

`MUST`：Nimi self-update、app updates（Nimi App registry）、与
Runtime local dependency updates（`K-LENG-024..K-LENG-028`、
`K-LENV-MAT-*`、`K-LENV-ACT-*`）是三个独立 authority surface。

`MUST NOT`：任一 surface 不得静默 mutate 另外两个 surface 的 source of
truth。

## P-PKGREL-008 — No Unrecorded Packaging Identity Split

`MUST`：packaging / release / update identity 是同一 authority family；不切出
未记录的 subordinate owner。如未来需要扩展 web 自更新或 web-only install
identity，必须由显式 `web-release-contract.md` cut 处理。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-self-update-contract.md` — `P-SUPD-001..P-SUPD-008`
- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-001..P-COLD-008`
- `.nimi/spec/platform/kernel/web-release-contract.md` — `P-WEB-*`
- `.nimi/spec/platform/kernel/tables/release-gate-registry.yaml`
- `.nimi/spec/canonical/desktop/shell-runtime.authority.yaml` — desktop-host self-update implementation
- `.nimi/spec/runtime/kernel/local-engine-runtime-environment-contract.md` — `K-LENG-024..K-LENG-027`
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md` — `K-LENG-028`
