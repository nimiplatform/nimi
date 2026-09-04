# 实例生命周期

Avatar 实例是一个运行中的 Avatar 进程，负责呈现一个经 Runtime 授权的
LocalAgent。启动时也可以指定已有的 Avatar 实例。活跃绑定与对话连续性归
Runtime 管理；Avatar 只管理本地外壳与渲染生命周期。

## 最小启动意图

默认启动载荷只包含以下字段：

| 字段 | 是否必需 | 含义 |
| --- | --- | --- |
| `agentId` | 是 | 调用方选择的 `local-agent:` 引用 |
| `avatarInstanceId` | 否 | 需要恢复的 Avatar 实例 |
| `launchSource` | 否 | 不具权威性的启动来源说明 |

Avatar 收到启动载荷后，会先交给 Runtime 验证，不会直接信任其中任何字段。
账户、用户、Realm 地址、凭据、对话锚点、视觉包、模型选择、校准参数、渲染
设置和原始文件路径都不能进入启动载荷。通过验证的原生宿主只会在受保护的
数据根目录下物化 Runtime 授权的视觉包。

Avatar 不读取也不保存访问令牌、刷新令牌、JWT、授权头或持久账户会话。需要
Realm 的操作由受保护的第一方 Runtime 接口完成。

## Runtime 活跃绑定

启动后，Avatar 请求 Runtime 解析或登记类型化的
`AvatarLiveInstanceBinding`。它把当前 Avatar 实例与 Runtime 管理的
LocalAgent、账户上下文和对话连续性关联起来。它不是公开注册表，也不是跨
App 订阅接口，更不是 Avatar 自己维护的 Agent 事实。

只有 LocalAgent、Avatar 实例、账户上下文和对话快照彼此一致时，Avatar
才接受该绑定。绑定缺失或不匹配时，外壳保持非就绪状态。

## 封闭的外壳生命周期

外壳只能处于以下状态之一：

| 状态 | 含义 |
| --- | --- |
| `loading` | 正在完成启动、Runtime 绑定和视觉载体就绪检查 |
| `ready` | 启动完成、Runtime 绑定有效，而且载体已有可见输出 |
| `degraded:reauth-required` | 受保护的 Runtime 会话需要宿主重新认证 |
| `degraded:cloud-offline` | 必需的云端访问当前不可用 |
| `degraded:runtime-unavailable` | 本地 Runtime 无法提供必需操作 |
| `degraded:launch-context-invalid` | 启动意图或解析后的绑定无效 |
| `error:bootstrap-fatal` | 启动流程无法继续 |
| `relaunch-pending` | 已确认的重新启动正在等待执行 |

只有 `ready` 会挂载具身呈现区域和用户明确打开的临时界面。其他状态会卸载
这些内容，只显示对应的加载、降级、错误或重启界面。Avatar 不会根据缓存或
测试夹具推断已经就绪。

## 读者场景：桌面端打开 Avatar

1. 桌面端发送 `{ agentId: "local-agent:ren" }`。
2. Avatar 验证载荷结构，并保持 `loading`。
3. 受保护的 Runtime 接口解析 LocalAgent、对话连续性快照和活跃实例绑定。
4. 原生宿主物化 Runtime 明确授权的视觉包。
5. Avatar 创建一个已支持的后端分支，并等待载体产生可见输出。
6. 外壳进入 `ready`。

桌面端不会通过启动载荷向 Avatar 传递视觉包、凭据、账户、模型或对话事实。

## 读者场景：Runtime 暂时不可用

1. Avatar 运行期间，一个必需的 Runtime 条件失败。
2. 外壳进入 `degraded:runtime-unavailable`。
3. 具身呈现区域和临时界面卸载。
4. Runtime 再次给出有效结果且视觉载体恢复就绪后，外壳才能回到 `ready`。

## 所有权一览

| 事项 | 所有者 |
| --- | --- |
| LocalAgent 执行与对话连续性 | Runtime |
| 活跃 `AvatarLiveInstanceBinding` | Runtime |
| 启动意图验证 | Avatar 外壳 |
| 受保护的视觉包物化 | 通过验证的 Avatar 原生宿主 |
| 外壳生命周期与本地呈现 | Avatar |
| 后端资源与关闭流程 | Avatar 后端分支 |

## 来源依据

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
