# 教程：用 Codex 开展受治理开发

本教程把 Nimi Coding 与 Codex 接在一起，但不会再建立第二套执行系统。Codex
负责任务、计划、子代理、重试、等待、恢复和完成状态；Nimi Coding 提供项目真相、
方法论、确定性门禁和证据契约。

完成后，仓库的 `.nimi/spec/**` 与宿主边界都经过验证，也能稳定验收 Codex 改动，
同时不会把任务状态镜像到项目文件里。

## 所有权边界

| 事项 | 所有者 |
| --- | --- |
| 任务规划与进度 | Codex |
| 并行工作与子代理 | Codex |
| 重试、等待、恢复与完成 | Codex |
| 产品与架构权威 | `.nimi/spec/**` |
| 变更分类与预检 | Nimi Coding 方法论 |
| 确定性验证 | 项目脚本与 Nimi Coding validators |
| 本地验证证据 | `.nimi/local/**` 下符合契约的工件 |

仓库不维护另一套任务生命周期。Codex 任务可以引用规范路径与证据工件，
但运行状态始终留在 Codex。

## 1. 验证真相表面

安装 workspace 并运行 Nimi compatibility 检查：

```bash
pnpm install
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

这些检查验证 package-canonical 文件与宿主专用内容。执行所有权上限本身由
`.nimi/spec/platform/authority-admission.authority.yaml` 中的 `P-PKG-011` 声明，
不再由 wrapper 命令承担。两项检查都不会创建产品权威。

## 2. 重建产品权威

需要重建时，当前 Codex 任务读取 `.nimi/config/spec-generation-inputs.yaml` 与
`.nimi/methodology/spec-reconstruction.yaml`，把权威重建到 `.nimi/spec/**`，并在
`.nimi/local/state/spec-generation/**` 中逐文件记录来源和未解决缺口，不会自行编造
规则。随后运行：

```bash
pnpm exec nimicoding validate-spec-tree .nimi/spec
pnpm exec nimicoding validate-spec-audit
```

validator 通过说明规范树符合已声明的契约，但不能替代产品负责人对权威决策的复核。

## 3. 编辑前先分类

涉及权威或跨层变更时，Codex 任务先记录一份有边界的预检：

- `Spec Status`：当前权威是否存在且足够明确
- `Authority Owner`：决定这项变更的规范表面
- `Work Type`：alignment、redesign、refactor 或其他已准入类型
- `Parallel Truth`：方案是否会制造第二份真相

如果权威缺失或互相矛盾，Codex 停止实现，并按准入流程更新规范。不能用应用层
局部规则掩盖权威缺口。

## 4. 由 Codex 执行

在 Codex 任务中描述结果，并链接相关规范。Codex 自行制定计划，在适合时拆出
有边界的并行工作，修改仓库并验证结果。Nimi Coding 不决定 Codex 的下一步，
也不启动另一条 Codex 会话。

实现期间：

- 读写范围不得越过预检里声明的权威所有者；
- 增加应用局部机制前，先复用共享 SDK 与 Kit 表面；
- 契约违反必须 fail closed；
- 已准入 redesign 改变真相时，先更新规范；
- 保留工作区里与当前任务无关的现有改动。

这些是项目约束，不是另一套调度器。

## 5. 运行范围化门禁

运行覆盖改动表面的 validators 与项目检查。具体命令以仓库当前说明和 package
scripts 为准：先跑最窄的受影响范围，跨权威边界时再补全局治理检查。

证据必须来自真实命令；app 或 UI 工作还必须来自真实应用 shell。单元测试通过
不能替代真实 runtime、控件可访问性、console、SDK 或 auth 连通性的失败。

契约要求的本地证据放在 `.nimi/local/**`。这些工件用于复核，不会自动成为语义
权威，也不记录 Codex 的任务进度。

## 6. 在 Codex 中完成任务

只有请求的结果与所需验证都真实成立，Codex 才能把任务标记为完成。最终交接说明：

- 哪些权威与实现表面发生了变化；
- 实际运行了哪些检查，结果如何；
- 适用时提供 runtime 或视觉证据；
- 是否仍有风险或待决事项。

仓库里不再设置执行关闭仪式。长期产品真相写入 `.nimi/spec/**`，长期验证逻辑
写入脚本和契约，任务完成状态归 Codex。

## 失败处理

| 失败 | 必须采取的动作 |
| --- | --- |
| 权威缺失 | 停止编辑，先解决规范中的权威归属 |
| 确定性门禁失败 | 修复根因并重新运行真实门禁 |
| runtime 与测试结论冲突 | 以 runtime 失败为准，并补回归覆盖 |
| 外部宿主不可用 | 如实报告阻塞，不制造输出或证据 |
| 方案会形成平行真相 | 实现前先把所有权收敛到规范层 |

## 来源依据

- [`.nimi/config/spec-generation-inputs.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/spec-generation-inputs.yaml)
- [`.nimi/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/spec-reconstruction.yaml)
- [`.nimi/contracts/spec-generation-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-generation-audit.schema.yaml)
