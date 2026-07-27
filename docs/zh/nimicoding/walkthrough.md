# 走查：受治理的认证迁移

团队要求 Codex 把桌面端自有认证路径替换为共享 SDK 与 Kit 认证表面。这项工作
会触及 token custody、runtime 连通性和用户可见 shell，因此属于高风险变更。

下面展示 Codex 自有执行如何与 Nimi Coding 的真相、方法论、门禁和证据结合。

## 1. 确认权威

Codex 读取当前平台、SDK、Kit 与桌面端规范。预检记录：

| 字段 | 决策 |
| --- | --- |
| `Spec Status` | 认证与 shell 权威已经存在 |
| `Authority Owner` | 平台认证契约，以及 SDK 与 Kit 公共表面 |
| `Work Type` | Alignment，不改变权威设计 |
| `Parallel Truth` | 禁止桌面端保留应用局部 token custody |

如果这些来源互相矛盾，实现必须停止，先完成权威收敛。

## 2. 在 Codex 中规划

任务计划留在 Codex App。Codex 可以让子代理分别读取 SDK、Desktop 与验证表面，
但只有一个任务所有者和一份完成状态。仓库不复制计划，也不保存执行 cursor。

实现边界明确为：

- 复用共享 SDK auth client；
- 消费 Kit shell 与 auth primitives；
- 删除 Desktop 局部 token 路径；
- runtime 或 auth 不可用时保持 fail closed；
- 在真实 app shell 验证桌面与窄屏布局。

## 3. 沿公共表面实现

如果缺少必要公共能力，Codex 先修改 SDK 或 Kit owner。Desktop 只消费公共表面，
不能新增内部 REST bypass、token store 或重复 UI primitive。

测试补在真正的 owner 层，并覆盖公共边界与失败态，而不只保护登录成功路径。

## 4. 运行确定性门禁

Codex 运行受影响的 SDK、Desktop 测试和仓库边界检查。只有真实命令实际运行并
返回结果，才能作为证据。

如果 validator 发现应用层 auth bypass，任务仍然开放。Codex 修复 owner 违规，
再重新运行检查。

## 5. 验证真实应用

Codex 启动真实 Desktop shell，检查：

- 未登录、登录中、已登录和认证失败状态；
- runtime 与 SDK 连通性；
- 禁用态与等待态控件；
- 桌面与窄屏布局；
- 长英文与中文文本；
- 键盘与可访问性行为；
- console error 和被拒绝的网络操作。

截图支撑视觉判断，DOM 与 runtime 检查确认结构和状态，两者不能互相替代。

## 6. 记录证据并完成

契约要求的本地证据记录命令、结果、runtime 观察和剩余风险。证据放在
`.nimi/local/**`，不能成为产品权威或任务状态。

只有迁移结果、owner 对齐、确定性门禁和真实 app 验收全部成立，Codex 才能把
任务标记为完成。长期结果如下：

| 表面 | 长期结果 |
| --- | --- |
| `.nimi/spec/**` | 认证与 shell 的规范真相 |
| SDK / Kit / Desktop | 对齐后的实现 |
| 脚本与测试 | 回归保护 |
| `.nimi/local/**` | 复核证据 |
| Codex | 任务进度与完成状态 |

## 来源依据

- [`.nimi/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/spec-reconstruction.yaml)
- [`.nimi/contracts/spec-generation-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-generation-audit.schema.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
