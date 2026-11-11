<!-- nimi-docs: {"authority":["rule.nimi.platform.core-protocol.p-arch-001a","rule.nimi.runtime.remote-access.direct-transport","rule.nimi.runtime.remote-access.source-admission"],"sources":["sdks/typescript/runtime/remote.ts","runtime/internal/remoteaccess","proto/runtime/v1/remote_access.proto"]} -->

# 本地优先与远程 Runtime 接入

当前 Nimi 由 PC 上的 Runtime 执行本地或云端 AI，桌面 App 以及获准的 Web、Android 客户端消费这些能力。手机或浏览器不必另装 Runtime。这里的**本地执行指 Runtime 主机上的执行**，主机可能与用户正在操作的屏幕位于不同设备。

## 当前连接方式

```text
桌面 App ── 经验证的原生 Host ──┐
                               ├── PC Runtime ── 本地模型 / 云端服务商
Web / Android ── WebRTC 直连 ───┘       │
                                        └── Conversation、App 数据、Cognition 桥接
Realm：账号身份、主 Runtime 绑定、来源资格与连接协调
```

远程客户端通过 Nimi 官方浏览器流程登录，再发现该账号绑定的主 Runtime。用户在 PC Home 开启远程接入，并确认已准入的来源。连接期间主机需要保持运行，账号与来源仍然有效，两端网络也必须能够直连。首次确认按账号、主 Runtime 和来源版本保存；只更换浏览器或设备，不需要增加长期审批记录。

Realm 和 App 的协调后端处理身份与连接协调；远程 AI 输入、结果和文件直接在客户端与 PC 之间传输。当前载体允许 STUN 发现，拒绝 TURN 和中继候选；不能直连时明确显示连接不可用，不自动启动另一个 Runtime，也不改走 AI 代理。应用应使用公共 SDK 载体，私有 Runtime 端口不属于接入方式。

## 模型执行与数据位置

先在主机准备模型资源，再在 App 或共享 LocalAgent AIConfig 中选择 `Local` 或 `Cloud`。Runtime 接受任务时固定本次生效配置。本地请求失败不会自动转为云端请求；选择云端后，该请求需要的上下文会发送给所选服务商。

获准的客户端连接同一个 LocalAgent 时，通过同一主机访问 Runtime 管理的 Conversation 和 Cognition 管理的记忆。App 私有数据仍遵循原有存储隔离。访问主机上已有的状态不等于跨 Runtime 复制；相同账号或 App 名称不会自动合并其他 Runtime 的数据库、硬件 Loadout 或记忆库。

关闭客户端只结束当前连接，不会停止 PC Runtime。连接断开后旧流结束；重连获取当前句柄，不重放业务请求。已经接受的持久 Job 继续遵循原有查询和取消合同。

## 联网条件与后续联邦方向

本地推理可否继续，取决于会话、授权、模型资产及策略是否仍然有效。新登录、主 Runtime 发现、建立连接、续期、Realm 操作和云端推理各自需要相应网络服务。远程接入不代表整个产品可以离线运行。

更多 Runtime 主机、自动跨主机同步和算力联邦需要独立的架构设计。当前多设备路径是多个客户端消费同一主 Runtime，尚不提供分布式执行调度。

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`.nimi/spec/platform/remote-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/remote-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
