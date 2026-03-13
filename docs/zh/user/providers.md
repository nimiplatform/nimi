# 云端 Provider 配置

Nimi 默认将 AI 请求路由到本地模型。云端 Provider 提供对 Google Gemini、OpenAI、Anthropic 等远程模型服务的访问。

## 工作原理

当你执行生成命令时，Nimi 按以下方式决定路由：

- **无参数**：使用默认本地模型
- **`--provider <name>`**：将本次请求路由到指定的云端 Provider
- **`--cloud`**：路由到已保存的默认云端 Provider

## 一次性使用 Provider

使用云端 Provider 最快的方式是一次性参数：

```bash
nimi run "Summarize quantum computing" --provider gemini
```

如果该 Provider 的 API key 尚未保存，Nimi 会提示你输入一次，将其保存到运行时配置中，然后继续执行当前命令。无需单独的设置步骤。

## 保存默认 Provider

如果你经常使用同一个云端 Provider，可以将其保存为默认值：

```bash
nimi provider set gemini --api-key-env NIMI_RUNTIME_CLOUD_GEMINI_API_KEY --default
export NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=YOUR_KEY
```

之后使用 `--cloud` 参数即可，无需指定 Provider 名称：

```bash
nimi run "Summarize quantum computing" --cloud
```

请求将始终通过已保存的默认 Provider 路由。

## 测试 Provider

验证 Provider 配置是否正确且可达：

```bash
nimi provider test gemini
```

此命令发送一个轻量级请求来确认连接性和 key 的有效性。

## 列出 Provider

查看所有已配置的 Provider 及其状态：

```bash
nimi provider list
```

获取机器可读输出：

```bash
nimi provider list --json
```

## 配置优先级

当存在多个配置来源时，Nimi 按以下顺序解析（优先级从高到低）：

1. **CLI 参数** -- 命令行上的 `--provider gemini`
2. **环境变量** -- 例如 `NIMI_RUNTIME_CLOUD_GEMINI_API_KEY`
3. **配置文件** -- `~/.nimi/config.json`
4. **内置默认值**

CLI 参数始终优先。如果你传了 `--provider openai`，即使已保存的默认值是 `gemini`，请求也会发送到 OpenAI。

## 可用的 Provider

Nimi 支持多种云端 Provider，包括 OpenAI、Anthropic、Google Gemini、DeepSeek、Azure OpenAI、Mistral、Groq、xAI 等。

完整的支持列表、各 Provider 的能力（文本、图像、音频、视频）及当前状态，请参阅 [Provider 矩阵](../reference/provider-matrix.md)。

## 另请参阅

- [用户快速入门](index.md) -- 五分钟完成首次生成
- [CLI 命令参考](cli.md) -- 所有可用命令
- [故障排除](troubleshooting.md) -- Provider 认证错误
