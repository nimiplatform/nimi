# Runtime AI 内容检查

Nimi 在用户本机的 Runtime 中直接执行内容检查。凡是通过 `text.generate` 调用模型的 App，都会对输入、生成输出和完整工具参数应用同一套检查规则，无论请求发往本地模型还是云端服务商。

比如，研究类 App 读取了一份包含私钥的文档，准备放入下一次提问；或者工具返回的令牌即将作为上下文再次送入模型。如果这些内容符合下述规则，请求会在发给模型前被拒绝。模型返回的内容也会接受检查。各个 App 保持自己的业务流程，无需分别维护一套扫描逻辑。

::: info 开发预览
当前 Runtime 源码构建已支持内容检查；预构建发布包的支持情况请以对应版本的发布说明为准。App 接入时无需增加请求字段、注册步骤或必填配置。
:::

## 本机检查如何工作

Runtime 本身负责识别调用方身份、托管服务商凭据并派发模型请求。在这里用确定性代码检查已知凭据格式，防护效果不再依赖模型是否遵守提示词中的安全指令。

检查完全在用户本机完成，不依赖网络，也不会把内容额外发送给远程检测服务。当 App 选择云端模型时，通过检查的请求仍会正常发送给所选的模型提供方。

各层职责保持独立：

| 工作 | 负责方 |
| --- | --- |
| 检查模型业务输入、输出与完整工具参数 | Runtime AI |
| 校验身份、权限、凭据托管与资源访问 | 既有 Runtime 资源服务 |
| 执行业务工具、组织多轮对话、展示结果与取得业务批准 | App 宿主 |

通过内容检查不代表获得权限，模型生成的 `approved: true` 等文字也不能代替真实授权。Integration 的业务结果与 Delegation 的审批策略保持原有行为。

## 检查范围与时机

当前检查仅覆盖 `text.generate` 的 `SYNC` 与 `STREAM` 路径；候选生成和 `RuntimeAgent` 调用在复用该路径时同样生效。其他 AI 能力、图片/音视频原始字节、`opaque continuity` 以及不经过该路径的调用不在覆盖范围内。

| 阶段 | 检查内容 | 命中后的处理 |
| --- | --- | --- |
| 模型输入 | 规范化后的业务文本和 JSON 字符串值：包括 system 文本、入选历史与摘要、工具说明与 schema、工具结果，以及可见媒体引用字符串 | 在派发模型、获取媒体资源、捕获请求体或创建新 Job 之前拒绝 |
| 流式输出 | 生成文本和可见推理概要（增量检查） | 停止未发送的输出，并通过既有流式 `failed` 与 Job 失败路径报告错误 |
| 工具调用 | 完整组装后的工具参数（先将 JSON 转义还原为实际值） | 在转发给 App 之前拒绝 |
| 最终结果 | 自然形成的完整文本、可见概要与工具参数 | 在发送尾部缓冲、正常完成或保存成功结果之前拒绝 |

普通输出沿用原有的分块和缓冲机制，不新增等待定时器、整步缓冲或额外的输出长度上限。由于传输分块边界不一定是完整的值边界，部分候选内容需要等到分隔符或逻辑项结束才能确认是否命中。

在流式输出中，确认命中前已经显示在界面上的文字无法撤回。这项检查用于拦截意外出现的凭据格式，但不能保证零泄露，也不是操作系统沙箱，无法阻止所有提示注入、恶意模型行为或任意数据外传。

## 当前规则

首批规则只针对少量结构明确的凭据格式，不会因为出现敏感词或高熵字符串就一概拦截。

| 规则 | 命中条件 | 检查方式 |
| --- | --- | --- |
| `pem-private-key` | 完整、未加密且可解析的 PEM 私钥：PKCS8（`PRIVATE KEY`）、PKCS1（`RSA PRIVATE KEY`）、SEC1（`EC PRIVATE KEY`） | 仅检查自然完整值 |
| `github-classic-pat` | `ghp_` 后接恰好 36 个 ASCII 字母或数字，且两侧满足标识符边界 | 完整值与增量文本 |

在 `github-classic-pat` 规则中，ASCII 字母、数字、下划线（`_`）和非 ASCII 字节均视为标识符的一部分，只有独立的 token 才会触发命中。规则仅判断格式是否匹配，不会联网验证凭据是否真实签发或仍然有效。

其他 token 格式、加密私钥、OpenSSH 私钥以及任意编码后的内容不在覆盖范围内。占位符和常见技术文本——例如 `token: string`、`password: <redacted>`、空值、普通哈希、单独的 PEM 头、公钥、证书、普通 `Bearer` 字样、敏感属性名、高熵字符串或提示注入措辞——都不会单独触发拒绝。

本地模型与云端模型使用相同的规则。请求中如果包含上述格式的完整私钥，即使用本地模型进行合法分析，也会被拒绝。可以通过 App 的输入控件提供自己脱敏后的副本；Runtime 不会静默改写原始内容。

## 在 App 中处理拒绝

当内容被拦截时，Runtime 会返回 gRPC `FailedPrecondition` 与错误码 `AI_CONTENT_FILTER_BLOCKED`（受保护的 App 载体对应标识为 `ai-content-filter-blocked`）。请通过 SDK 提供的类型化错误或事件分支处理，不要靠解析面向用户的错误文案来判断原因。

- **输入被拒绝**：调用在创建新 Job 或建立输出流之前直接返回错误。按调用错误处理，此时没有流内 `failed` 事件或成功结果。
- **输出被拒绝**：已建立且仍可发送的流会通过既有 `failed` 路径报告失败（并记录 Job 失败）。请将整轮模型调用视为失败，**禁止继续执行该失败轮次中先前收到的任何 `ToolCall`**。
- **用户引导**：提示用户内容过滤阻止了本次请求或响应，引导其检查并移除或脱敏输入与所选上下文后再重新提交。不要自动原样重试、重放工具，或自动切换模型、Provider 及本地/云端路由。

可参考如下提示：

> 这次请求或响应未通过内容检查。请检查输入和所选上下文，移除或脱敏受限内容后再提交。

真实的取消、超时、权限错误、Runtime 关闭和传输失败仍保留各自的错误原因与优先级。内容检查的诊断只记录规则、阶段等信息，不保存命中的秘密。已知用量可随原 Job 记录保留；没有用量数据，并不代表失败的调用没有产生费用。

## 历史记录与会话恢复

Runtime 不会全局改写或清理 App 已保存的历史记录，诊断记录也不代表旧历史已被清理。旧记录依然可读，但只要历史消息或摘要被选入新的请求，就会再次接受检查；如果其中仍包含命中内容，后续哪怕是普通提问也会被拒绝。

App 可以通过既有的上下文编辑或新建对话入口，让用户主动移除受限内容。`RuntimeAgent` 重新 Open 时会复用原有 anchor 而不会清空上下文，Runtime 也不会为此新增自动清理、历史免检或重置协议。如果某段会话的入选上下文仍包含受限内容，而 App 没有既有的恢复入口可供移除，请如实告知用户该会话无法继续推理。

## 继续接入

- [完成第一次 AI 调用](/zh/sdk/first-ai-call)
- [流式行为](/zh/runtime/streaming)
- [传输与错误](/zh/sdk/transport-and-error)

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`runtime/internal/riskcontrol/detector.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/riskcontrol/detector.go)
- [`runtime/internal/services/ai/text_risk_checks.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/services/ai/text_risk_checks.go)
