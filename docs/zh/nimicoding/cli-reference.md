# CLI 参考

这页在概念层描述 Nimi Coding CLI 面的角色。它**不**是完整命令手册。

## CLI 是干嘛的

CLI 存在是为了让治理动作显式：

- 创建并校验 topic；
- 加、选、准入 wave；
- 冻结执行 packet；
- Dispatch worker 或审计步骤；
- 记结果；
- 闭 wave 与 topic；
- 校验生命周期与图一致性。

那些命令重要因为 topic 状态**不**该只住在聊天 transcript 里。它要持久工件、好让别的 session 能审计。

## 阅读场景：为什么独自工作时 CLI 也不可选

某独立开发者用 AI 辅助跑一个 wave end-to-end。CLI 在那个场景下看起来冗余；开发者已经知道在发生什么。CLI 仍然重要因为：

1. 它产出的工件是未来 review（或未来 contributor）重建决定的方式。
2. 校验步骤抓单个 session 可能漏的形状错。
3. 工件构成审计步骤所赖的边界。
4. Closeout 工件把「这事真做完了」记下来，超过单凭记忆的份量。

独立开发者从团队会有的同样闸门里受益。闸门是保护工作日后**不**悄悄漂移的东西。

## 命令类别，读者级

| 类别 | 覆盖什么 |
| --- | --- |
| Topic | Init、validate、hold（pending）、close |
| Wave | Add、select、admit、close |
| Packet | Freeze、validate |
| Execution | Preflight、dispatch、record result |
| Audit | 记审计证据、judge |
| Validation | 生命周期与图一致性检查 |

确切命令参数属于本地 CLI help 与方法学源。公开命令例子只在项目稳定外部用户路径后才在文档里出现。

## 阅读场景：抓漂移的校验步骤

某人手编辑 topic 工件、改成不再匹配 schema 的形状。校验命令把它露为类型化错误，**不**让漂移溜过。

那是一个小例子，但是方法学所赖的那种 guardrail。CLI 是强制形状的东西，让审计步骤有干净证据可工作。

## 怎么用这页

用这页理解工作流类别。确切命令参数查本地 CLI help 或 `.nimi/topics/**` 里既有 topic 工件。公开命令例子只在项目稳定外部用户路径后才该扩展。

## 来源

- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
