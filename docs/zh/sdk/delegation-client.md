# 委托客户端

## 状态：已准入，正在构建中

运行时委托客户端合约已在SDK内核级别被准入。该合约规定了SDK消费者如何与运行时委托网关和输出防火墙集成；客户端界面正处于积极构建中。

## 该客户端的作用

委托客户端是用于集成委托功能的模块或应用程序的SDK界面，通过运行时委托网关提出观察、查询、意图、工具请求、展示更新、创建工件或受控测试。

所有提议都需经过运行时输出防火墙（参见[Runtime → Delegated Capability](/runtime/delegated-capability)）。SDK不允许任何提议在通过防火墙之前到达消费者界面。

## 方法界面

| 方法 | 目的 |
| --- | --- |
| `OBSERVE` | 提交类型化的观察 |
| `QUERY` | 提交类型化的查询 |
| `SUGGEST_INTENT` | 提议一个意图 |
| `SUGGEST_TOOL_REQUEST` | 提议一个工具调用 |
| `SUGGEST_PRESENTATION` | 提议一个展示更新 |
| `CREATE_ARTIFACT` | 提议创建一个工件 |
| `CONTROLLED_TEST` | 运行一个受控的沙盒测试 |

所有这些都是**建议/观察**，而不是动作。

## 无回退开关

SDK界面故意不暴露路由/提供者救援回退旋钮。内部运行时回退可能作为一种低级策略存在，但它不能削弱类型化的公共合约。未能通过防火墙的委托将作为类型化失败报告——而不是默默地使用不同的提供者重试。

## 读者场景：模块提议一个工具调用

由外部AI支持的模块提议一个工具调用。

1. **模块调用SDK。** `delegationClient.suggestToolRequest(...)`.
2. **运行时委托网关打开。** 根据提供者配置文件的信任层级。
3. **输出防火墙验证。** 模式、来源、描述符哈希、敏感度分类、提示中毒检测。
4. **裁决。** 类型化裁决（`ACCEPTED_SUGGESTION`、`APPROVAL_REQUIRED`、`QUARANTINED`等）。
5. **如果批准：** 运行时在其自身的审计谱系下执行；SDK将类型化结果呈现给模块。

## 该客户端不做的事情

- 它不允许提议绕过输出防火墙。
- 它不暴露路由或提供者救援旋钮。
- 它不允许消费者代码直接执行提议的动作。
- 当合约失败时，它不会默默地跨提供者重试。

## 来源依据

- [`.nimi/spec/sdks/kernel/runtime-delegation-client-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/runtime-delegation-client-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md)
