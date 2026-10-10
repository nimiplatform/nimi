# Memory 与 Knowledge

长期 Memory 及其生命周期归 Cognition。Runtime 负责 LocalAgent 身份、Conversation、授权、上下文组装，以及投递已提交事件、返回有限 Memory 结果的强类型桥接。Knowledge 属于 Cognition 领域，但 V1 没有活动的读写或公共客户端路径。

## 每个 Agent 独立记忆

每个 LocalAgent 有独立、不透明的 Memory bank。共享 Character Source 不会共享记忆。Character 和 World 的来源真相归 Realm，Memory 不能改写规范世界状态或历史。

任何操作到达 Cognition 前都由 Runtime 检查访问权限。App 不能直接查询 Cognition 语料、选择账号级记忆库，也不能用本地消息缓存重建记忆。Memory 管理使用独立准入的 Runtime 接口；普通 Agent 对话访问不会附带记忆管理权限。

## 对话与召回

Runtime 保存已提交的 Conversation，并可在规划一轮对话时向 Cognition 请求相关记忆。召回是可选的：未准备好、索引不可用或没有匹配项，都返回零条可选记忆，不阻塞其他条件有效的对话。这不允许伪造召回，也不允许回退到另一套 Runtime 记忆库。

Memory 的准入、更正、替代、遗忘与派生索引状态，都由 Cognition 决定和提交。只有 owner 持久提交结果后才能宣告写入成功。具体操作见 [Cognition](/zh/cognition/)。

## 开关与删除

每个 LocalAgent 有独立 Memory 开关，与共用的 LocalAgent AIConfig 无关。新 LocalAgent 默认开启；切换到 V1 前已存在的 LocalAgent 需要明确启用。关闭在持久化截止点停止新投递与召回，但不删除已有记忆。重新开启不补放关闭期间的事件，也不恢复截止点前未完成的工作。

清空记忆保留开关值，通过 owner 生命周期屏障删除该 Agent 的 Memory。撤销 App 访问只移除该 App 的权限，不删除 Agent 记忆。LocalAgent 终止和实际观察到的规范账号删除信号各有删除规则；退出登录、网络故障和切换账号都不是账号删除信号。

## Knowledge V1

V1 没有通用 Knowledge 导入、搜索、CLI 或 SDK 接口。Conversation 摘要、不可变 Character/World lorebook 上下文、Cognition 来源检索与 Knowledge 是不同概念。接口缺失不能通过已撤销的 wire 方法绕过。

## Source Basis

- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
