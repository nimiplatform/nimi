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

远程客户端先通过 Nimi 官方浏览器流程登录，再发现该账号绑定的主 Runtime。用户需在 PC Home 中开启远程接入，并确认已准入的来源。连接期间，主机需保持运行、账号与来源状态有效，且两端网络能够直连。首次确认记录按账号、主 Runtime 和来源版本保存；仅更换浏览器或设备时，无需新增长期审批记录。

Realm 和 App 的协调后端处理身份与连接协调；远程 AI 输入、结果和文件直接在客户端与 PC 之间传输。当前载体允许 STUN 发现，拒绝 TURN 和中继候选；不能直连时明确显示连接不可用，不自动启动另一个 Runtime，也不改走 AI 代理。应用应使用公共 SDK 载体，私有 Runtime 端口不属于接入方式。

## 模型执行与数据位置

使用前先在主机上准备好模型资源，再在 App 或共享的 LocalAgent AIConfig 中选择 `Local` 或 `Cloud`。Runtime 接收任务时会锁定本次生效配置。本地请求失败不会自动转为云端请求；选择云端后，本次请求所需的上下文会发送给所选服务商。

获准的客户端连接同一个 LocalAgent 时，通过同一主机访问 Runtime 管理的 Conversation 和 Cognition 管理的记忆。App 私有数据仍遵循原有存储隔离。访问主机上已有的状态不等于跨 Runtime 复制；相同账号或 App 名称不会自动合并其他 Runtime 的数据库、硬件 Loadout 或记忆库。

关闭客户端只会断开当前连接，不会停止 PC Runtime。连接断开后旧流随即结束；重连后会获取当前句柄，但不会重放业务请求。已接受的持久 Job 继续遵循原有的查询和取消合同。

## 离线连续性、重新登录条件与后续联邦方向

Runtime 将本机已建立的可信登录身份与短期在线 Realm 凭据分离，使已登录设备在断网时仍可继续本地工作：

- **已登录设备离线可继续使用的范围**：当本机已完成可信统一账号登录且 Runtime 仍持有有效、未被撤销的本地登录托管记录时，即使 Realm 断联或短期在线 Access Token 在离线期间自然过期，Home 仍可冷启动并保持可用；已准备的本地模型、经授权的本地 App 数据与 LocalAgent 对话按各自归属校验继续运行。对于已安装的官方校验 App，当官方 Registry 不可达时，只要安装身份、账号有效性与本地授权仍然成立，Runtime 会不限时长地复用该精确安装目标上一次经官方核验通过的审批结果（本地缓存读取、启动、重启与失败检查都不会刷新审批时间）。
- **何时需要在线重新登录**：已过期、已清除或缺失的在线令牌绝不会用于授权在线 Realm、云端账号或受保护的远程接入操作，这些调用会如实返回网络不可用或需要在线认证。若在线刷新出现结果不明确或可能已轮换的情形（例如发出请求后传输中断、Realm 返回 503 无法核验，或重启恢复遇到刷新前崩溃围栏），Runtime 会立即清除并隔离可能已轮换的在线令牌而不重放，同时保留本机可信登录身份；此时需在 Home 重新完成在线认证才能恢复在线 Realm 与远程接入。首次登录、新装或更新官方校验 App、主 Runtime 发现以及云端推理同样需要联网。
- **退出、吊销与 Kill-Switch 立即生效**：主动退出登录、切换账号、已确认的吊销/封禁/注销，或契约无效的刷新失败会立即使在线凭据与本地登录身份同时失效，并隔离受影响的会话与任务。对于已安装校验 App，一旦观测到生效中的 kill-switch 或 Registry 中不存在该记录，即便之后 Registry 不可达也会立即拦截新的启动与绑定。

更多 Runtime 主机、自动跨主机同步和算力联邦需要独立的架构设计。当前多设备路径是多个客户端消费同一主 Runtime，尚不提供分布式执行调度。

## Source Basis

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
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
