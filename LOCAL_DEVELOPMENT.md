# Nimi 本地联调开发指南

本文面向在 Windows 上联调 Realm、Web、fixed Runtime、Desktop 与第三方 Nimi App 的开发者。联调沿用生产授权边界：账号认证、项目准入、精确 operation grant、Runtime owner enforcement 四层相互独立；本地开发不会获得 bearer、隐式 grant 或绕过 presence 的通道。

> 当前恢复包状态（2026-07-17）：`dev:runtime`、Desktop 签名 carrier 与 bounded zero-grant Agent inventory 已从 protected Runtime RPC 贯通到 Kit、SDK 和 Zhiyu；验证过的 local-development session 可直接通过 `agent.listInventory()` 获得有界伙伴清单，日常启动不需要 harness selector。Realm broker 等尚未逐操作准入的能力仍保持 fail-closed，不要用普通 gRPC 补洞。

## 五个入口

| 工作目录 | 命令 | 职责 | 常驻 |
|---|---|---|---|
| `D:\nimi-realm` | `pnpm dev` | Realm API，默认 `localhost:3002` | 是 |
| `D:\nimi-realm\nimi` | `pnpm dev:web` | Web/login，默认 `localhost:3000` | 是 |
| `D:\nimi-realm\nimi` | `pnpm dev:runtime` | build/sign → 原地更新已安装 fixed service → 重启 → status；未提权时弹一次 UAC | 仅 Runtime 变更时 |
| `D:\nimi-realm\nimi` | `pnpm dev:electron:desktop` | 签名 Desktop carrier、持久 profile、renderer HMR、项目/grant 审批宿主 | 联调期间 |
| `D:\nimi-realm\nimi` | `pnpm dev:electron:zhiyu` | `nimi-app dev --shell electron`，经 Desktop 完成项目准入并启动 Zhiyu | 联调期间 |

建议顺序：Realm → Web → fixed Runtime status → Desktop → Zhiyu。不要启动第二个前台 Runtime；`dev:runtime` 只更新 SCM 管理的 `NimiRuntime`。

需要让连续的 dev-kernel candidate 复用一个既有 `nimi_data` payload 根时，必须由
operator 在 signed-installer 更新链上显式选择：

```powershell
pnpm dev:runtime -- --development-data-root <absolute-existing-nimi-data-root>
```

该参数只传给 signed installer 写入 candidate-bound protected profile；不会成为
Runtime argv、环境变量或 renderer 配置。新 candidate 仍重建隔离的 Product Control、
registry 与 readiness 证据，既有模型、依赖、环境字节只有在当前 catalog hash、
manifest、compatibility 与 activation 全部重新验证后才复用。省略该参数时，
dev-kernel profile 有意使用 candidate-specific fallback root；因此连续更换 candidate
可能重新物化大型 payload。

运行 `pnpm doctor:dev` 可在一屏检查 Realm/Web 可达性、fixed service 完整状态、Desktop local-development presence 的 exact shape/新鲜度、遗留 carrier，以及 SDK/Kit canonical dist stamp。任一 Tier-1 项不满足时命令非零退出。Developer Mode、项目授权与 grant 摘要目前没有获准的 bounded doctor projection，输出固定为“bounded projection 未准入”，不读取 renderer private bridge，也不把缺失投影算作通过。

## 签名 Desktop dev profile 的一次性 First Run

签名 Desktop 使用持久 dev profile；新 profile 首次出现 First Run 是预期行为，完成记录按 data root 保存。决议 12 后，Storage 页用 `Choose folder…` 选择既有 Nimi data root 时，Product Control 会通过受保护的 typed config mutation 写入 Runtime service-owned `dataRootRef` 与派生 `managedRoots`，再由 typed fixed-service restart 使 localservice、engine manager 与 app storage 从同一根构造。既有模型只会在 catalog digest 和 managed-asset 校验通过后被收养；缺失、不完整或 hash 不匹配会 fail-closed 回到正常物化路径。

2026-07-16 的真实签名 carrier 复验选择既有 `D:\DataNimi` 与 Minimal：First Run 完成，Product Control 为 `ready_for_use`，local text/STT/TTS 均产生 `local_ai_ready` 执行证据，且没有出现第二份 GB 级模型 payload。后续新 candidate 复用同一 data root 时同样没有新增 GB 级下载；小型环境脚本或 PID 更新属于正常执行态，不代表模型被重复物化。

## 修改后的动作

| 修改对象 | 动作 |
|---|---|
| Desktop renderer | Vite HMR，不重启 carrier |
| Zhiyu renderer | Vite HMR，不重启 host |
| Zhiyu `src-electron` main/preload | Desktop supervisor 450ms 防抖后运行 `build:electron` 并替换 host |
| Desktop main/preload | `build:electron` 后重启签名 carrier；应用 JS 从 repo `dist-electron` 加载，不重签 carrier |
| Runtime Go | `pnpm dev:runtime`；该命令轮换 boot epoch |
| SDK/Kit | 单独运行 `pnpm dev:prepare:watch`；350 ms 防抖后串行调用 SDK、Kit canonical build，SDK 变化会继续重建 Kit |

Runtime 重启后，旧 session、launch lease 与 scoped binding 失效；同一 supervisor run 由既有链重新建立。账号 custody 与 durable grant 不因重启消失，也不重复项目 consent。`run_once` 在 supervisor 结束后失效；`remember_project` 转 dormant，重新激活需要 fresh presence。

`dev:prepare:watch` 不使用直接 `tsc --watch` 或 `vite build --watch` 生成半成品 dist；Zhiyu supervisor 的 `build:electron` 也不会暗中重建 SDK/Kit，失败时只报告 freshness 并提示启动 watcher。Kit CSS 的 Tailwind `@source` 会读取 dist，且 Vite dep optimizer 可能缓存旧 dist；canonical round 成功后若 renderer 仍显示旧依赖，重启对应 renderer，必要时再清理该 app 的生成态 `.vite` cache。

## 项目准入与 operation grant

1. Desktop 开启 Developer Mode。该开关不授予任何 API 权限。
2. `nimi-app dev` 发送 canonical project root、manifest/app id、shell/entry、renderer origin 与 capability fingerprint。
3. 用户在 Desktop 选择 `run_once` 或 `remember_project`，并完成真实 presence。
4. App 以 zero-grant session 启动。首次具体 operation 必须被拒绝或进入 pending。
5. App 显式请求 exact operation + resource；用户在 Desktop 批准并再次完成 presence。
6. revoke 后下一次 operation 必须拒绝。账号切换不得继承 grant。

## 常见 reason code

| reason code | 含义 | 处置 |
|---|---|---|
| `local-development-desktop-not-running` | Desktop presence 不存在或过期 | 启动 `pnpm dev:electron:desktop`，确认窗口仍运行后重试 |
| `runtime-service-unavailable` | fixed service/pipe 不可用 | 先运行只读 status；Runtime 源码变更后用 `pnpm dev:runtime` 更新 |
| `pending-approval` / `request-pending` | 等待真实用户决定 | 切回 Desktop 查看项目或 operation 审批，不循环重试 |
| `runtime-unauthenticated` | Runtime custody 没有 authenticated account | 在 Desktop 完成登录，不向 renderer 注入 token |
| `no-grant` | zero-grant 或 operation/resource 未授权 | 通过 App 的权限请求入口发起 exact grant |
| `grant-revoked` / `grant-superseded` | grant 已失效 | 按当前 operation/resource 重新申请，不复用旧 ID |
| `presence-expired` | reauth presence 过期 | 重新完成浏览器 presence |
| `project-changed` | root/manifest/fingerprint/shell/origin 发生变化 | 检查项目内容并重新走项目准入 |
| `protected-carrier-required` | 使用了不可信或缺失的 carrier | Desktop 使用签名 dev carrier；第三方 App 必须由 Desktop supervisor 启动 |

## 验收 harness 节奏

- 日常修改：单文件 `node --test`、包级 test、Runtime developer/owner-batch、必要的 `cargo test`。
- 入口修复后：真人 V-J1 冒烟；失败用 targeted test 复现。
- 手工链稳定后：一次 owner-minimal。
- candidate 冻结后：一次 fresh First Run。
- 最终 candidate-bound close：一次 fresh-prepared 完整 journey。

First Run、owner-minimal、fresh-prepared journey 与 `check:zhiyu-bootstrap` 不是调试启动器。它们要求干净 tracked 树与无 carrier 进程，旧 candidate 的证据不能关闭新 candidate。

运行 owner-minimal、fresh First Run 或完整 core journey 前，需求方维护的 Realm 必须以测试专用策略从 `D:\nimi-realm` 重启；四项环境必须同时成立：`NIMI_REALM_TEST_POLICY=dev_kernel_checkpoint`、`NODE_ENV=development`、`HOST=127.0.0.1`、`CORS_ORIGINS=http://localhost:3000`。该策略只允许回环访问；`GET http://localhost:3002/api/auth/dev-kernel-policy` 必须返回 HTTP 200，缺失或非 200 时 harness fail-closed，不得在 Nimi 侧补固定策略或 fallback。

## 第三方 App 接入 local development 清单

### Manifest

- 根目录有 `nimi.app.yaml`，`app_id` 固定且与 SDK caller/app package 一致。
- `local_development.electron.renderer_origin` 是 exact loopback origin；不得使用 wildcard。
- shell/entry 与 execution profile 使用已准入值。
- `permissions.declared_nimi_api_scopes` 逐项写 purpose/qualifier。
- `runtime_scoped_binding_requests` 只是 request eligibility，不是 grant，也不允许 third-party app 铸造 first-party scoped binding。

### package.json 脚本逐字契约

Electron app 至少提供：

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

不要新增 Agent ID、token、Runtime endpoint 或 grant ID 的开发者传参面。测试 observation 只能通过显式 checkpoint harness 注入。

### Shell 与能力面

- Electron main 使用 `registerNimiElectronAppBridge`；不得创建 ordinary Runtime gRPC client。
- preload 使用 Kit 标准 bridge；renderer 不接触 Node、raw IPC、bearer、principal/session proof。
- renderer origin、project root 与 host executable 必须与 Desktop 批准的计划一致。
- 为 bundled/production 能力建立 parity 矩阵：account/session、Realm broker、Agent inventory/chat、artifact/media/voice、memory、app storage、Avatar handoff。
- 每项只能是“真实可用”或“明确 fail-closed（reason code + action hint + 权威事项）”；禁止静默缺失和伪成功。
- zero-grant、grant request/approve、revoke 后拒绝、account switch、Runtime restart、HMR/host replacement 都要有 targeted 回归。

### 可复制性验收

接入 tester/avatar/nimi-apps 时复用同一 manifest、脚本、origin、Desktop approval 与 exact grant 模式。不要为第二个 app 新建 harness 依赖、auth custody、shell bridge 或 Runtime bypass。
