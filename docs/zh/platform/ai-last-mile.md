# AI Last Mile

当前 AI last mile 是从已授权 user intent 进入 Runtime LocalAgent 执行，再以
强类型产品投影返回 consumer 的路径。

Runtime 持有 LocalAgent Conversation、运行态 Memory 与 Knowledge、Local 与
Cloud AI 消费、具体实现选择、执行准入、预算、Credential 与 App authorization。
SDK 暴露有限的公共访问面。App 持有产品交互与渲染，但不持有执行真相。

## 核心路径

1. 用户或 App 通过 SDK 提交强类型 intent。
2. Runtime 从 active session 推导 account、App identity、authorization 与
   LocalAgent access。
3. Runtime 评估能力意图、authorization、Quota 与 Budget，再选择获准的具体实现。
4. Runtime 在提交 Conversation 或其他 LocalAgent 真相前校验执行输出。
5. Consumer 只取得已授权的强类型投影。

Provider call、原始 parser output、Credential、Runtime proof 与私有 context
不会进入 App-owned state。

## 可选 External Action

External action plane 可以被单独准入，但不属于上述核心路径。它缺失或失败时，
不得阻塞普通 LocalAgent Conversation、Memory、Knowledge、voice 或 AI 执行。

该隔离边界见 [委派能力](/zh/runtime/delegated-capability)。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
