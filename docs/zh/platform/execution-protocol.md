# 可选 Action 执行

Nimi 可以为外部或委派 action 提供可选的 fail-closed 边界。这项能力不是
Local AI、LocalAgent、Conversation、Memory、Knowledge 或普通 Runtime
readiness 的前置。

## 安全顺序

Action surface 启用完整执行边界时，使用以下顺序：

```
discover → dry-run → verify → commit → audit
```

| 阶段 | 安全结果 |
| --- | --- |
| `discover` | 只返回当前 scoped principal 可见的 action |
| `dry-run` | 生成强类型提案，不提交副作用 |
| `verify` | 按当前意图与策略核对提案 |
| `commit` | 在幂等保护下执行已授权 action |
| `audit` | 记录结果与 lineage |

Verify 失败不会进入 commit。Commit 的 audit 结果不确定时，系统 fail
closed。高风险 action 不能绕过 owner 要求的安全结果。

## Owner 边界

Action owner 定义允许的操作、输入、输出、风险分类与授权结果。Runtime
可以提供 delegated gateway、approval 与 output firewall，但不会接管 Realm
或 App 真相。Nimi Home 或其他宿主可以呈现审批 UI，却不会成为 action
authority。

这条边界不等于通用 Workflow、MCP、A2A 或公共 Action Registry。未来
adapter 若使用它，仍需单独 owner，并保持非阻塞。

## 场景：经过 Verify 的写操作

一项可选外部 action surface 提出写操作。

1. Discover 返回 scoped operation。
2. Dry-run 生成无副作用的强类型提案。
3. Verify 核对当前意图与策略。
4. Commit 只执行一次。
5. Audit 记录终态结果。

如果第三步 Verify 失败，流程会在 Commit 前停止，并返回强类型拒绝。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
