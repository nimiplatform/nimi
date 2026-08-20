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
| `pnpm dev:desktop [--cdp]` | Windows/macOS 日常 Electron UI、main、preload 与显式 loopback CDP 迭代 | Windows 使用已安装 fixed service；macOS workspace Electron 明确不可用 |
| `pnpm dev:zhiyu [--cdp]` | 由已运行的 Desktop supervisor 启动 Zhiyu Electron App | 取决于当前受保护 Desktop/Runtime |
| `pnpm dev:lab [--cdp]` | 由已运行的 Desktop supervisor 启动 Nimi Lab Electron App | 取决于当前受保护 Desktop/Runtime |
| `pnpm dev:avatar [--cdp]` | 启动 avatar-only Desktop Electron carrier；与普通 Desktop dev 实例互斥 | 取决于 Avatar launch binding |
| `pnpm dev:avatar --tauri` | 显式启动 Avatar Tauri carrier；不支持 CDP | 取决于 Avatar launch binding |
| `pnpm dev:runtime` | Windows/macOS 构建并更新健康的已安装 fixed service | 可用 |
| `pnpm dev:runtime -- --install` | macOS 首次安装固定 ad-hoc development candidate | 可用 |
| `pnpm dev:macos:desktop:installed` | macOS 启动 renderer 与已安装的 `/Applications/Nimi Dev.app` | 可用 |
| `nimi-app dev --shell electron` | 由 Desktop supervisor 启动第三方 Electron App | 取决于当前受保护 Desktop/Runtime |

根目录 `dev:<app>` 默认使用 Electron。CDP 默认关闭；`--cdp` 显式开启并使用
互不重复的仓库默认值：Desktop `9333`、Zhiyu `9334`、Nimi Lab `9335`、Avatar
`9336`。需要覆盖时直接使用 `--cdp=<port>`，例如：

```bash
pnpm dev:zhiyu --cdp
pnpm dev:lab --cdp=19468
```

Zhiyu 与 Nimi Lab 不会自行启动第二个 Desktop；先运行并登录 Desktop，再运行对应
命令。Avatar Electron 使用 avatar-only Desktop carrier，不能与普通
`pnpm dev:desktop` 并行。只有 Avatar 提供显式 `--tauri`；Tauri 不是 Desktop、
Zhiyu 或 Nimi Lab 的本地开发载体，且 `--tauri` 不能与 `--cdp` 组合。

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
pnpm dev:desktop --cdp
```

该命令使用 workspace Electron，适合 UI、main、preload 与 loopback CDP。它不是
已安装的固定 carrier，所有 protected operation 必须返回 typed unavailable。

### 固定 ad-hoc development candidate

```bash
pnpm dev:runtime -- --status
pnpm dev:runtime -- --install
pnpm dev:runtime
NIMI_DESKTOP_DEV_CDP_PORT=9333 pnpm dev:macos:desktop:installed
```

`--install` 只用于 `absent` 状态的首次安装。此后无参数
`pnpm dev:runtime` 与 Windows 一样是日常更新入口：先构建完整候选，经 sudo 授权后替换
当前健康安装，并检查新 Runtime 回到 `running/healthy`。更新前状态不是健康
`present` 时不会猜测性修复。日常更新保留已验证的 `_nimiruntimedev` principal、
protected state 与 Keychain namespace；只有显式 `--uninstall` 才删除这些安装状态。

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
| Desktop Electron main/preload | workspace 路径自动重建；macOS protected 路径运行 `pnpm dev:runtime` 更新 |
| 第三方 App renderer | Desktop supervisor 保持 renderer 与 host 生命周期绑定 |
| 第三方 App `src-electron` | supervisor 防抖构建并替换 host |
| Runtime Go | Windows/macOS 均用 `pnpm dev:runtime` 更新健康的已安装 fixed service |
| SDK/Kit | Desktop 开发 carrier 自动 ensure 并持续 watch；无需由 Zhiyu/Nimi Lab 重建 |

`pnpm dev:desktop` 会在构建自身 Electron host 前启动 SDK/Kit canonical watcher，
等待共享 `dist` 可用且新鲜后再启动 renderer。已有 freshness stamp 且源码未变化时
不会重复构建。avatar-only Electron carrier 复用同一个 Desktop 入口，因此遵循相同
规则；Zhiyu 与 Nimi Lab 的 `build:electron` 只校验并消费这份产物。

仅在不启动 Desktop、单独迭代 SDK/Kit 时使用根命令
`pnpm dev:prepare:watch`；不要与 Desktop 托管的 watcher 并行运行。

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
