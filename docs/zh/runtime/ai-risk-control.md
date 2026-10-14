# 集中式 AI 风控

Nimi 将模型内容检查放在用户设备上的 Runtime 中。通过同一条文本生成路径调用模型的 App，共享对输入、生成输出和完整工具参数的检查，本地与云端采用一致的规则。

例如，研究 App 读取了一份含私钥的文档，并准备把它加入下一次模型请求。Runtime 可以在派发模型之前拒绝这次请求。写作 App 的提示词、工具返回后再次送入模型的内容，也经过相同的检查。App 继续负责自己的业务流程，公共执行层提供可复用的防护。

::: info 开发预览
当前 Runtime 源码构建已实现这项能力。使用前请确认 Runtime 构建包含此功能；公开下载包的支持情况以对应发布说明为准。App 无需增加请求字段、注册步骤或必填风控配置。
:::

## 多个 App，共用一个检查位置

Runtime 已经负责识别获得授权的调用方、托管模型服务凭据，并执行选定的模型请求。内容检查进入这条公共执行路径后，规则可以在同一层持续完善，开发者沿用既有接口和 AI 宿主，无需在每个 App 中分别维护一套扫描器。

已覆盖格式由确定性代码检查，不依赖模型是否遵守提示词中的安全要求。

这里的“集中式”指检查集中在本机 Runtime。检测本身不依赖网络，也不会把内容额外发送给远程安全服务。选择云端模型时，通过检查的请求仍会发送给所选模型服务商。

各层职责保持清晰：

| 工作 | 负责方 |
| --- | --- |
| 检查模型业务输入、输出与完整工具参数 | Runtime AI |
| 校验身份、权限、凭据使用与资源访问 | 原有 Runtime 资源服务 |
| 执行业务工具、组织后续模型轮次、展示结果与取得业务批准 | App 原有宿主 |

未命中检测规则不代表取得了权限。模型生成的 `approved: true`、角色或身份声明，都不能代替真实授权。

## 检查发生在哪里

当前覆盖 `text.generate` 的 SYNC 与 STREAM 路径。候选生成和 RuntimeAgent 调用在经过同一 Scenario 时，也会接受这些检查。

| 位置 | 检查内容 | 命中后的行为 |
| --- | --- | --- |
| 模型输入 | 实际规范化的业务文本和 JSON 字符串值，包括 system 文本、入选历史与摘要、工具说明/schema、工具结果，以及可见媒体引用字符串 | 在派发模型、获取媒体资源、捕获新请求正文或创建 Job 前拒绝 |
| 增量输出 | 文本和可见推理概要 | 停止尚未交付的内容，通过原流式通道报告失败 |
| 工具调用 | 已完整组装的参数；JSON 转义先还原为实际值 | 在转发给 App 前拒绝 |
| 最终结果 | 已自然形成的完整文本、可见概要与工具参数 | 在尾部缓冲发送、正常完成与成功保存之前拒绝 |

正常内容沿用原分块和缓冲策略。检查不会增加等待定时器、整步输出等待或新的统一输出上限。传输块结束不等于文本值结束：有些候选需要等真实分隔符或内容项完成，才能确认是否命中；这不会让普通文本停下来等待检查。

## 首批规则

当前采用少量明确格式规则，不把所有“像凭据”的内容一律阻断。

| 规则 | 命中条件 | 支持方式 |
| --- | --- | --- |
| `pem-private-key` | 完整、未加密且可解析的 PEM 私钥：PKCS8（`PRIVATE KEY`）、PKCS1（`RSA PRIVATE KEY`）、SEC1（`EC PRIVATE KEY`） | 完整值检查 |
| `github-classic-pat` | `ghp_` 后恰好 36 个 ASCII 字母或数字，两侧满足标识符边界 | 完整值与增量检查 |

token 规则将 ASCII 字母、数字、下划线和非 ASCII 字节视为标识符的延续。命中只说明格式符合规则，不会联网验证凭据是否真实签发或有效。其他 token 格式、加密或 OpenSSH 私钥格式，以及任意编码后的内容不在这两条规则的覆盖范围。

`token: string`、`password: <redacted>`、空值、普通哈希、单独 PEM 头、公钥和证书不会独立触发拒绝。普通 Bearer 字样、敏感属性名、高熵或提示注入措辞，也不单独作为硬阻断依据。

## App 如何处理拒绝

新的 Runtime 内容判定使用 gRPC `FailedPrecondition` 与 `AI_CONTENT_FILTER_BLOCKED`。受保护的 App 载体也有对应的 `ai-content-filter-blocked` 标识。请读取所用 SDK 提供的带类型错误或事件，不要通过匹配用户文案推断错误原因。

- **输入被拒绝**：原调用直接返回错误，此时没有新 Job 或输出流，不会伪造流内 `failed` 或成功结果。
- **输出被拒绝**：已建立且还能发送的流返回 `failed`。保留原始原因，将整个模型步骤视为失败；此前收到的 ToolCall 不能因此继续执行。
- **向用户解释**：说明内容过滤阻止了本次请求或响应，引导用户检查输入与所选上下文，显式移除或脱敏后再提交。不要自动原样重试、重放工具，或切换模型、Provider 和 Local/Cloud 路由。

可使用这样的提示：“内容过滤阻止了这次请求或响应。请检查输入及所选上下文，移除或脱敏受限内容后再提交。”

真实取消、超时、权限失效、Runtime 关闭和传输失败仍保留各自含义。新增 Runtime 风控诊断只记录必要的规则与阶段信息，不记录命中秘密；已有 App 历史不会被全局重写或脱敏。已经取得的 usage 可沿原 Job 记录保留，缺少 usage 不代表失败调用没有费用。

## 流式与上下文的使用限制

Nimi 保留正常流式体验，因此在确认命中之前，部分文字可能已经显示。确认后会停止剩余交付，但无法撤回已经显示的文本，不能据此承诺零泄露。

本地模型输入也使用相同规则。即使目的是合法分析，包含完整私钥的本地请求仍可能被拒绝。可以通过已有输入控件提供自己明确脱敏的副本；Runtime 不会静默改写原文件或内容。

原历史记录保持可读。如果入选历史或摘要持续包含命中材料，后续普通问题也可能被拒绝。App 可以使用其已有的显式上下文编辑或新对话入口；RuntimeAgent 重新 Open 通常复用同一 anchor，不会清空历史。在这些内容仍被选入、且没有现成恢复入口时，该会话继续推理会受限。此功能不新增自动清理、历史免检或重置协议。

图像、音视频、opaque continuity、其他 AI 能力，以及不经过这条文本生成路径的调用，不属于当前检测范围。Integration 的业务结果和 Delegation 的审批政策保持不变。这是一层公共模型边界防护，不是操作系统沙箱，也不保证识别恶意模型、提示注入或任意方式的数据外传。

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
