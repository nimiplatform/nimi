# 创建 Nimi App

当你需要一个 Nimi App 开发仓库时，使用 `@nimiplatform/app-tools`。CLI 会创建 scaffold 输入和本地检查；它不会授予公开准入、权限、registry 可见性、release descriptor，或 installed-app update truth。

## 创建 Scaffold

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app create --dir my-nimi-app --profile standalone
cd my-nimi-app
pnpm install
pnpm run init
```

`standalone` 是外部开发者仓库布局。它会创建 project configuration 与 submitted manifest input；这些文件不会成为 Nimi 产品 authority。`workspace-app` 只是 `apps/<app>/` 下的内部 monorepo 布局，不是已准入的 app-local spec slice，也不是面向用户的产品 profile。

## 本地运行和检查

```bash
pnpm dev:shell
pnpm run validate
pnpm run local-audit
pnpm run doctor
```

`pnpm dev:shell` 会启动生成的 Tauri shell。Native host 会注入 standard-shell local-app carrier。尚未准入的本地项目必须先由 Developer Mode 授权，再以隔离的 `local_development` build 启动。Scaffold 不拥有 principal、grant、session 或 Runtime account custody。

如果你只需要验证 SDK 是否能调用 Runtime-backed 文本生成，先读 [第一次 AI 调用](/zh/sdk/first-ai-call)。

如果你要接入共享 UI、auth、shell、telemetry 或 model configuration，先读 [在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)。

## Scaffold 拥有什么

| 文件或命令 | 含义 |
| --- | --- |
| `nimi.app.yaml` | 开发者提交的 manifest input，不是 admitted descriptor truth |
| `pnpm run init` | 显式 scaffold activation 和 `.nimi/{config,contracts,methodology}` projection |
| `pnpm run doctor` | Scaffold state、dependency alignment、managed glue 和 projection drift 检查 |
| `pnpm run update` | 刷新 scaffold-managed glue，同时保留 app-owned product code |
| `pnpm run local-audit` | 本地 pre-submission evidence，不是 platform admission |

## Reference App

`apps/tester/` 是 Nimi Lab developer reference app。它展示 Runtime authenticated shell、Kit workbench surfaces、AI capability lanes、app-owned history storage 和 local acceptance checks。它可供 SDK、Kit、app-tools 与 Runtime auth integration 参考，但不是 platform admission truth。
阅读路径见 [把 Tester 当作 Reference App 使用](/zh/start/use-tester-as-reference)。

## 来源依据

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`apps/tester/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/README.md)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
