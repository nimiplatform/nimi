# Self-Update Contract

> Authority: Desktop Kernel

## Scope

Desktop self-update and its coordination boundary with the independently
installed Runtime OS service. Desktop is not a Runtime installer, stager,
binary selector, service owner, or stop authority.

## Signed Compatible Release Pair (D-BOOT-001, D-IPC-014)

- The Desktop package contains only its own signed release metadata and the
  Platform release-root public key; it does not contain or stage a production
  Runtime binary.
- Signed installer/service updater installs each Runtime release into the
  immutable OS release layout, writes the signed protected-local trust record,
  and atomically activates the signed service definition.
- Desktop and Runtime may update independently only when both signed trust
  records name the same protected-local protocol version and mutually list the
  observed peer release ids. Semver, PATH lookup, `NIMI_RUNTIME_BINARY`, user
  choice, argv, env, cache, and manifest guess are not compatibility proof.
- When a Desktop update requires a new Runtime release, the service updater
  must finish the compatible Runtime activation before Desktop reports the
  update ready. Failure leaves the old coherent pair active or marks protected
  control unavailable; no partially compatible success is allowed.

## Installed Runtime Truth Source (D-BOOT-001, D-IPC-002)

- Typed service status derives from the fixed OS service definition, running
  service principal, protected mutual handshake, platform-native code signing, and
  same-open-file executable verification.
- Desktop never executes a stopped/candidate Runtime for version discovery and
  never reads `~/.nimi/runtime/versions`, `current.json`, a user config path, or
  a candidate binary path.
- Missing, expired, rollback, incompatible, or mismatched service/record/binary
  state returns typed unavailable/repair-required status. Renderer/backend
  cannot synthesize fallback release information.

## Updater Configuration Contract (D-IPC-015)

- updater pubkey 与 endpoint 的单一来源是 Rust builder 的编译期内嵌配置。
- Packaged product updater configuration accepts no runtime env override.
  Separately signed synthetic non-product fixtures use an external test trust
  root and cannot provide production evidence.
- renderer 不得直接拼装 updater 细节；desktop update surface 必须经受管 Tauri commands 暴露。

## Renderer / Web Surface Contract (D-IPC-015)

- `desktop_release_info_get` 只有在 release metadata 初始化成功时才允许返回 `DesktopReleaseInfo`。
- 初始化失败时，command 必须返回错误；renderer 单独持有 `desktopReleaseError`，不得由 bridge 合成默认版本信息。
- web adapter 对 desktop self-update / release metadata surface 必须 fail-close。`unsupported` 是唯一允许的结果，不得返回 `null`、`idle`、no-op unsubscribe 等伪状态。

## 更新器可用性投影

- `DesktopReleaseInfo` 必须暴露 `updaterAvailable`，并可选暴露 `updaterUnavailableReason`。
- Bootstrap 与 Settings UI 必须使用该投影判定 desktop self-update actions 是否可用。
- 当 `updaterAvailable=false` 时，静默检查必须 no-op；手动 update 操作必须直接展示 `updaterUnavailableReason`，而不是调用已知会失败的 updater command。
- Settings projects Desktop release id, verified installed Runtime service
  release id, mutual compatibility state, target Desktop release and updater
  state. It exposes no Runtime path or credential. Desktop restart means only
  Desktop process restart.
- Runtime service update/repair errors remain visible as service-updater state
  and are never hidden by fallback version information.
