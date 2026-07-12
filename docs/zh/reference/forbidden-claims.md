# 禁止声明

本文档列出了公开文档中禁止出现的各类声明及相应的自动化检测模式。在相关证据获得正式准入前，公开文档不得发布此类内容。

## 禁止的标记字符串

| 标记 | 检测模式 | 禁用原因 |
| --- | --- | --- |
| `TODO` | `\bTODO\b` | 未完成的工作项；应在议题系统（Issue Tracker）中跟踪，不应出现于正式文档。 |
| `TBD` | `\bTBD\b` | 同上。 |
| `FIXME` | `\bFIXME\b` | 同上。 |
| `lorem` | `\blorem\b`（忽略大小写） | 无意义的排版占位文本。 |
| `placeholder` | `\bplaceholder\b`（忽略大小写） | 无意义的占位文本。 |
| `coming soon` | `\bcoming soon\b` | 构成对未来的非正式承诺，可能引发不准确的预期。 |

## 禁止的安装与分发引导 (CTA)

在某组件的分发证据正式开放并获得准入前，公开文档禁止出现以下具引导性的安装命令或操作号召（CTA）：

| 检测模式 | 禁止形态 | 允许的客观表述示例 |
| --- | --- | --- |
| `curl `（后接 URL） | 一行可直接执行的安装命令 | 客观说明当前尚未开放 curl 安装途径及原因。 |
| `npm install` | 直接安装命令 | 客观说明当前尚未开放此安装方式。 |
| `pnpm install` | 直接安装命令 | 客观说明当前尚未开放此安装方式。 |
| `brew install` | 直接安装命令 | 客观说明当前尚未开放此安装方式。 |
| `apt-get install` | 直接安装命令 | 客观说明当前尚未开放此安装方式。 |
| `yarn add` | 直接安装命令 | 客观说明当前尚未开放此安装方式。 |
| `early access` | 作为报名或注册通道的引导 | — |
| `early-access` | 作为报名或注册通道的引导 | — |
| `download`（动词式） | 直接可点击的下载链接 | 客观陈述该组件未来的分发规划。 |
| `release notes` | 版本的正式发布通告 | 客观陈述该组件的发布策略。 |
| `version 1.0` / `v1.0` | 对未落地版本做出具体声明 | — |
| `launching` / `launches` | 上线营销通告 | 允许使用 "Pre-launch" 等客观术语描述当前阶段。 |
| `ships` / `shipped` / `shipping` | 用于宣称某功能已面向公众可用 | 允许使用 "Not yet shipped" 或 "publicly shipped" 等客观表述。 |

## 禁止提及的具体 Provider 与模型名称

在外部 Provider 及模型目录的可用性证据对公众开放前，公开文档禁止点名具体的 Provider 或模型品牌：

| 禁用词汇 | 检测模式 | 补充说明 |
| --- | --- | --- |
| `OpenAI` | 词边界匹配 | |
| `Anthropic` | 词边界匹配 | |
| `Claude` | 词边界匹配 | 仅允许在概念演示中作为泛指的“外部 AI 宿主”被提及。 |
| `Gemini` | 词边界匹配 | |
| `GPT-`（带版本号） | 正则匹配 | |
| `Llama` | 词边界匹配 | |
| `DeepSeek` | 词边界匹配 | |
| `Mistral` | 词边界匹配 | |
| `Qwen` | 词边界匹配 | |
| `Ollama` | 词边界匹配 | |
| `vLLM` | 词边界匹配 | |
| `Cohere` | 词边界匹配 | |
| `Groq` | 词边界匹配 | |
| `Bedrock` | 词边界匹配 | |
| `Azure`（特指 AI Provider 时） | 词边界匹配 | |

## 禁止的提前承诺声明

| 严禁出现的声明表述 | 推荐的合规表述 |
| --- | --- |
| 针对已定义但未上线的组件宣称 "X is available now" | "X 在契约层面已获得准入" |
| 宣称 "X is GA (Generally Available)" | "X 已取得正式的契约准入证据" |
| 宣称 "X is stable" | "X 目前处于已定义的架构面阶段" |
| 宣称 "今天您就可以将 X 安全地用于生产环境" | "X 已获得准入；是否适用于生产环境需视后续证据落地情况而定" |

## Nimi Coding 规范层面的反模式

Nimi Coding 规范拒绝以下工程反模式。描述 Nimi Coding 的公开文档不得暗示系统设计采用了以下任何手段：

| 反模式标识 | 拒绝的工程实践 |
| --- | --- |
| `mvp_subset_contract` | 将完整的规范契约削减为临时的子集。 |
| `legacy_alias` | 滥用软别名（Soft Alias）以延续应被淘汰的过时语义。 |
| `compat_shim` | 依赖临时兼容垫片（Shim）以掩盖架构权责划分不清的问题。 |
| `dual_read` | 在系统中保留未获显式规范准入的并行读取路径。 |
| `dual_write` | 在系统中保留未获显式规范准入的并行写入路径。 |
| `placeholder_success` | 在核心数据尚未就位时，使用虚假逻辑冒充任务成功或闭合。 |
| `happy_path_only_closure` | 仅验证顺畅路径（Happy Path）便宣告议题闭合。 |
| `time_phased_layering` | 采用时间版本切片（如 v1/v2）替代合理的架构语义分层。 |
| `app_local_shadow_truth` | 允许应用层因本地便利性而维护未经约束的“影子规范真相”。 |
| `silent_owner_cut_reopen` | 在下游实现工作中，越权修改应归属于上游数据所有者的事实真相。 |

## 自动化检测机制

平台将在集成流水线中使用仓库级 `grep` 命令对所有公开文档进行核验：

```bash
grep -rEn 'TODO|TBD|FIXME|coming soon|lorem|placeholder' \
  README.md docs/*.md docs/**/*.md

grep -rEni '^[^>]*\b(curl |npm install|pnpm install|brew install|apt-get install|yarn add|early.?access)' \
  README.md docs/*.md docs/**/*.md

grep -rEni '\b(OpenAI|Anthropic|Claude|Gemini|GPT-[0-9]|Llama|DeepSeek|Mistral|Qwen|Ollama|vLLM|Cohere|Groq|Bedrock|Azure)\b' \
  README.md docs/*.md docs/**/*.md
```

除在引用语境或明确表达“客观解释姿态”的合法使用外，若上述命令返回任何非空匹配结果，即判定文档引入了违规声明，将拦截发布流程。

## 来源依据

- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/runtime/kernel/model-catalog-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/model-catalog-contract.md)
- [`.nimi/spec/runtime/kernel/provider-health-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/provider-health-contract.md)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`nimi-coding/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/product-scope.yaml)
- [`nimi-coding/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/bootstrap-state.yaml)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
