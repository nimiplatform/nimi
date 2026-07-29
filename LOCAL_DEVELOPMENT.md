# Nimi 本地开发指南

本文描述 Windows 与 macOS 当前唯一受支持的 Desktop/Runtime/第三方 App
开发路径。项目尚未发布：开发路径使用当前固定实现，不提供 legacy、dual path、
自动迁移或测试旁路。

本地开发保留真实产品安全边界：

- Runtime 只能由平台固定服务承载；
- Desktop 只通过受保护的 Desktop control carrier 访问 Runtime；
- 第三方 App 只由 Desktop supervisor 启动；
- renderer 不持有 bearer、Runtime endpoint、principal、grant、lease 或 session；
- Developer Mode、项目同意与具体 operation permission 相互独立；
- 无法建立受保护 carrier 时返回 typed unavailable，不伪造成功。

## 开发路径

| 路径 | 用途 | 受保护 Runtime |
|---|---|---|
| `pnpm dev:desktop` | Windows/macOS 日常 Electron UI、main、preload 与 loopback CDP 迭代 | Windows 使用已安装 fixed service；macOS workspace Electron 明确不可用 |
| `pnpm dev:runtime` | Windows 构建并更新已安装 fixed service | 可用 |
| `pnpm dev:runtime -- --install` | macOS 构建并安装固定 ad-hoc development candidate | 可用 |
| `pnpm dev:macos:desktop:installed` | macOS 启动 renderer 与已安装的 `/Applications/Nimi Dev.app` | 可用 |
| `nimi-app dev --shell electron` | 由 Desktop supervisor 启动第三方 Electron App | 取决于当前受保护 Desktop/Runtime |

Tauri 不是 Desktop 或第三方 App 的本地开发载体。

## Windows

建议顺序：

1. 启动 Realm 与 Web。
2. 运行 `pnpm dev:runtime`，更新并检查已安装的 `NimiRuntime` fixed service。
3. 运行 `pnpm dev:desktop`。
4. 在 Desktop 中登录、开启 Developer Mode。
5. 在目标 App 目录运行 `pnpm dev`。

`pnpm dev:runtime` 不接受 data-root、candidate、profile 或 trust override。已有
Windows protected-local schema 与当前 schema 不一致时，使用一次性、非产品化的
精确 protected-state reset 后重新安装；不实现兼容读、自动迁移或 dual schema。

## macOS

### 普通 Electron 迭代

```bash
pnpm dev:desktop
```

该命令使用 workspace Electron，适合 UI、main、preload 与 loopback CDP。它不是
已安装的固定 carrier，所有 protected operation 必须返回 typed unavailable。

### 固定 ad-hoc development candidate

```bash
pnpm dev:runtime -- --status
pnpm dev:runtime -- --install
NIMI_DESKTOP_DEV_CDP_PORT=9333 pnpm dev:macos:desktop:installed
```

macOS development candidate 的边界是固定的：

- `/Applications/Nimi Dev.app`
- `/Library/Application Support/Nimi/RuntimeDev`
- `/Library/LaunchDaemons/ai.nimi.runtime.dev.plist`
- `/usr/local/libexec/nimi-macos-dev-security`
- `/private/var/run/nimi-dev`
- 非登录 `_nimiruntimedev` principal

candidate 使用 ad-hoc signing、固定 signing identifiers、hardened Runtime、严格
code-seal 验证、固定 root-owned 安装路径与 Runtime-only Keychain custody。它不要求
Apple certificate、Team ID 或 notarization，也不形成 production readiness。

出现 `partial` 时先检查 status 报告的精确固定路径，再显式运行：

```bash
pnpm dev:runtime -- --uninstall
```

随后从 `absent` 做一次 fresh install。不要增加 FreshCarrier、signed-trial、
acceptance round、profile、role record、receipt 或自动 repair 流程。

## Product Control 与 data root

Product Control 是普通产品状态，不属于 development candidate identity。Runtime、
Desktop、installer、CLI、环境变量与测试输入都不能选择或覆盖 `dataRoot.path`。
首次选择只通过正常 Product Control UI；后续服务与候选安装只读取该 canonical
选择。

Runtime/Desktop 安装、卸载、重启或 candidate replacement 不得重建 Product Control、
改变 `installId` 或重置已完成 First Run。损坏状态进入正常 repair；fresh Product
Control 只来自显式 destructive reset。

## 修改后的动作

| 修改对象 | 动作 |
|---|---|
| Desktop renderer | Vite HMR |
| Desktop Electron main/preload | workspace 路径自动重建；macOS protected 路径重建 candidate 后重新安装 |
| 第三方 App renderer | Desktop supervisor 保持 renderer 与 host 生命周期绑定 |
| 第三方 App `src-electron` | supervisor 防抖构建并替换 host |
| Runtime Go | Windows 用 `pnpm dev:runtime` 更新；macOS 重建并 fresh install 固定 candidate |
| SDK/Kit | 运行 `pnpm dev:prepare:watch` |

Runtime restart、host replacement、renderer dev server 退出、authority 刷新失败或
supervisor 结束都必须终止旧 host carrier。持久项目同意可以保留，但每次需要新的
进程绑定、lease 与 session。

## 项目准入与 operation permission

1. Desktop 开启 Developer Mode；该开关不授予 API permission。
2. `nimi-app dev` 提交 canonical project root、manifest/app id、Electron entry、
   renderer origin 与 capability fingerprint。
3. 用户选择本次运行或记住项目。
4. Desktop supervisor 构建并启动 exact Electron host。
5. App 请求具体 operation/resource；Runtime 根据当前账号与 permission 判定。
6. revoke、账号切换、Runtime replacement 或 supervisor termination 后，旧 carrier
   不得继续运行或恢复受保护访问。

## 验证原则

日常修改只运行最近的 build/test。涉及 fixed carrier 时，在 candidate 稳定后执行
一次真实旅程：

```text
absent
→ install
→ healthy status
→ installed Desktop
→ loopback CDP
→ one third-party Electron App
→ Runtime restart/revoke
→ uninstall
→ absent
```

这条真实旅程和相关直接测试就是当前验收。不要建立 owner-minimal、
fresh-prepared、candidate-bound evidence、checkpoint harness 或多轮自动证明流程。

## 第三方 App 最小合同

`nimi.app.yaml` 必须声明固定 `app_id`、精确 permission 请求和 canonical loopback
Electron renderer origin。`package.json` 至少提供：

```json
{
  "scripts": {
    "dev": "nimi-app dev --shell electron",
    "dev:shell": "nimi-app dev",
    "dev:renderer": "vite --host 127.0.0.1 --port <manifest-port> --strictPort",
    "build:electron": "<deterministic main/preload build>"
  }
}
```

Electron main 使用 `registerNimiElectronAppBridge`；preload 使用 Kit 标准 bridge；
renderer 不接触 Node、raw IPC 或受保护 session material。不得增加普通 Runtime gRPC
client、localhost trust、mock auth、direct shell launch、token 参数或 protected
operation pseudo-success。
