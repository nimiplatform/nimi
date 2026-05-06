# 禁用主张

公开文档当前不发布的主张类别参考，带检测模式。

## 禁用 marker 字符串

| Marker | 模式 | 原因 |
| --- | --- | --- |
| `TODO` | `\bTODO\b` | 未完工；该跟在 topic 里、**不**在文档里 |
| `TBD` | `\bTBD\b` | 同 |
| `FIXME` | `\bFIXME\b` | 同 |
| `lorem` | `\blorem\b`（不分大小写） | 占位文本 |
| `placeholder` | `\bplaceholder\b`（不分大小写） | 占位文本 |
| `coming soon` | `\bcoming soon\b` | 未来承诺漏 |

## 禁用安装 / 分发 CTA

分发证据被闸住时，这些模式**不**该作为公开文档的 call-to-action 出现：

| 模式 | 禁用形式 | 允许的负向姿态 |
| --- | --- | --- |
| `curl `（带 URL） | 安装一行 | 讨论 curl 安装为何被闸 |
| `npm install` | 安装命令 | 讨论包安装为何被闸 |
| `pnpm install` | 安装命令 | 讨论包安装为何被闸 |
| `brew install` | 安装命令 | 讨论 brew 安装为何被闸 |
| `apt-get install` | 安装命令 | 讨论 apt 安装为何被闸 |
| `yarn add` | 安装命令 | 讨论 yarn 安装为何被闸 |
| `early access` | 注册 CTA | — |
| `early-access` | 注册 CTA | — |
| `download`（作 CTA 动词） | 下载链 | 讨论分发姿态 |
| `release notes` | 公开发布公告 | 讨论发布姿态 |
| `version 1.0` / `v1.0` | 具体版本声明 | — |
| `launching` / `launches` | 发布公告 | 「Pre-launch」散文允许 |
| `ships` / `shipped` / `shipping`（作可用性声明） | 上线 / 已发布声明 | 「尚未上线」 / 「公开上线」散文允许 |

## 禁用具体 Provider / Model 名

Provider 目录证据被闸时，公开文档**不**命名具体 Provider 或 Model：

| 禁用 | 模式 |
| --- | --- |
| `OpenAI` | 词边界 |
| `Anthropic` | 词边界 |
| `Claude`（作 provider/model） | 词边界；只在走查上下文「一个外部 AI host」时允许 |
| `Gemini` | 词边界 |
| `GPT-`（带版本） | regex |
| `Llama` | 词边界 |
| `DeepSeek` | 词边界 |
| `Mistral` | 词边界 |
| `Qwen` | 词边界 |
| `Ollama` | 词边界 |
| `vLLM` | 词边界 |
| `Cohere` | 词边界 |
| `Groq` | 词边界 |
| `Bedrock` | 词边界 |
| `Azure`（作 AI provider） | 词边界 |

Runtime providers-and-models 页里那一句负向姿态「provider names」被允许，因为它是拒绝短语、**不是**名字。

## 禁用未来承诺声明

| 声明 | 允许替代 |
| --- | --- |
| 「X 现在可用」（X 是 defined-but-not-shipped 面） | 「X 在合同层被准入」 |
| 「X 是 GA」 | 「X 有 admitted 合同证据」 |
| 「X 稳定」 | 「X 是 defined surface」 |
| 「今天就用 X 做生产」 | 「X 已准入；生产姿态依准入证据」 |

## 方法学侧禁用捷径

Nimi Coding 方法学拒这些命名反模式。描述 Nimi Coding 的公开文档**不**能声称用了任何这些：

| Key | 拒绝模式 |
| --- | --- |
| `mvp_subset_contract` | 把规范化合同真相切成临时最小子集 |
| `legacy_alias` | 用软别名让旧语义存活 |
| `compat_shim` | 把 owner-cut gap 藏在临时兼容代码后 |
| `dual_read` | 没显式准入的两条并行真相读路径 |
| `dual_write` | 没显式准入的两条并行真相写路径 |
| `placeholder_success` | 缺必需真相时伪造成功或闭合 |
| `happy_path_only_closure` | 只闭 happy path 就声称闭合 |
| `time_phased_layering` | 用时间切片（v1/v2/v3）替代语义分层 |
| `app_local_shadow_truth` | App 局部便利状态变成隐藏规范化真相 |
| `silent_owner_cut_reopen` | 在下游执行 wave 内重开 owner 域真相 |

## 检测

Wave 级 grep 用来校验公开文档：

```bash
grep -rEn 'TODO|TBD|FIXME|coming soon|lorem|placeholder' \
  README.md docs/*.md docs/**/*.md

grep -rEni '^[^>]*\b(curl |npm install|pnpm install|brew install|apt-get install|yarn add|early.?access)' \
  README.md docs/*.md docs/**/*.md

grep -rEni '\b(OpenAI|Anthropic|Claude|Gemini|GPT-[0-9]|Llama|DeepSeek|Mistral|Qwen|Ollama|vLLM|Cohere|Groq|Bedrock|Azure)\b' \
  README.md docs/*.md docs/**/*.md
```

非空匹配（除引用 / 拒绝上下文里的负向姿态措辞）表示禁用主张被引入。

## 来源

- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/runtime/kernel/model-catalog-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/model-catalog-contract.md)
- [`.nimi/spec/runtime/kernel/provider-health-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/provider-health-contract.md)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
