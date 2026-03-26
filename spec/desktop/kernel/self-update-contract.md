# Self-Update Contract

> Authority: Desktop Kernel

## Scope

Desktop 自更新与 bundled runtime 发布契约。该契约是 `D-BOOT-001`、`D-IPC-002`、`D-IPC-009` 在“packaged desktop 壳 + bundled runtime”场景下的强约束收口。

## Atomic Desktop Release Unit (D-BOOT-001, D-IPC-009)

- packaged desktop release 必须将 desktop shell 与平台专属 bundled runtime 视为同一个原子发布单元。
- packaged desktop 不得再依赖 `PATH`、用户手工安装 binary、或产品路径上的 `NIMI_RUNTIME_BINARY` 覆盖来发现 runtime。
- `desktop-release-manifest.json`、`resources/runtime/manifest.json`、平台 runtime manifest、打包应用版本号必须保持同一 semver。
- packaged desktop 的 desktop 版本与 runtime 版本必须 exact match。任何 drift 都视为发布错误或 runtime staging 失败，不允许受控降级为“部分可用”。
- `NIMI_RUNTIME_BINARY` 只允许作为测试覆盖入口，不属于任何产品语义。

## Bundled Runtime Truth Source (D-BOOT-001, D-IPC-002)

- release 模式启动时，Desktop 必须先读取 embedded release manifest，再 staging bundled runtime 到 `~/.nimi/runtime/versions/<version>`，最后切换 `current.json`。
- Desktop 不得仅依赖 manifest 猜测 runtime 版本。staged binary 必须执行 `nimi version --json`，并以其 `nimi` 字段作为 runtime 真值。
- 若 `nimi version --json` 缺失、不可解析、执行失败、或返回版本与 manifest `runtimeVersion` 不一致，Desktop 必须 fail-close 拒绝启动 managed runtime，并将错误暴露给 renderer。
- `RuntimeBridgeDaemonStatus.version` 在 release 模式下必须优先来自运行期 runtime 自报；daemon 未运行时才允许回退到 staged bundled binary 的 `nimi version --json` 结果，不得回退到 manifest 假值或缓存猜测值。

## Updater Configuration Contract (D-IPC-009)

- updater pubkey 与 endpoint 的单一来源是 Rust builder 的编译期内嵌配置。
- 运行时 env override 仅允许用于测试、诊断、或 CI 注入，不得成为 packaged app 正常运行所需前提。
- renderer 不得直接拼装 updater 细节；desktop update surface 必须经受管 Tauri commands 暴露。

## Renderer / Web Surface Contract (D-IPC-009)

- `desktop_release_info_get` 只有在 release metadata 初始化成功时才允许返回 `DesktopReleaseInfo`。
- 初始化失败时，command 必须返回错误；renderer 单独持有 `desktopReleaseError`，不得由 bridge 合成默认版本信息。
- web adapter 对 desktop self-update / release metadata surface 必须 fail-close。`unsupported` 是唯一允许的结果，不得返回 `null`、`idle`、no-op unsubscribe 等伪状态。

## Updater Availability Projection

- `DesktopReleaseInfo` 必须暴露 `updaterAvailable`，并可选暴露 `updaterUnavailableReason`。
- Bootstrap 与 Settings UI 必须使用该投影判定 desktop self-update actions 是否可用。
- 当 `updaterAvailable=false` 时，静默检查必须 no-op；手动 update 操作必须直接展示 `updaterUnavailableReason`，而不是调用已知会失败的 updater command。
