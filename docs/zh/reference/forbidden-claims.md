# 禁止声明

公开文档禁止声明清单及检测模式。在发布前，相关证据未准入之前，公开文档不发这些声明。

## 禁止标记字符串

| 标记 | 模式 | 原因 |
| --- | --- | --- |
| `TODO` | `\bTODO\b` | 未完成工作；应在议题里跟踪，不进文档 |
| `TBD` | `\bTBD\b` | 同上 |
| `FIXME` | `\bFIXME\b` | 同上 |
| `lorem` | `\blorem\b`（不区分大小写） | 占位符文本 |
| `placeholder` | `\bplaceholder\b`（不区分大小写） | 占位符文本 |
| `coming soon` | `\bcoming soon\b` | 未来承诺泄漏 |

## 禁止的安装 / 分发 CTA

在分发证据未开放期间，公开文档不出现以下 CTA 命令：

| 模式 | 禁止形态 | 允许的反向姿态 |
| --- | --- | --- |
| `curl `（后接 URL） | 一行安装命令 | 讨论 curl 安装为何尚未开放 |
| `npm install` | 安装命令 | 讨论 pkg 安装为何尚未开放 |
| `pnpm install` | 安装命令 | 讨论 pkg 安装为何尚未开放 |
| `brew install` | 安装命令 | 讨论 brew 安装为何尚未开放 |
| `apt-get install` | 安装命令 | 讨论 apt 安装为何尚未开放 |
| `yarn add` | 安装命令 | 讨论 yarn 安装为何尚未开放 |
| `early access` | 报名 CTA | — |
| `early-access` | 报名 CTA | — |
| `download`（动词式 CTA） | 下载链接 | 讨论分发姿态 |
| `release notes` | 公开发布通告 | 讨论发布姿态 |
| `version 1.0` / `v1.0` | 具体版本声明 | — |
| `launching` / `launches` | 上线通告 | 允许 "Pre-launch" 说明 |
| `ships` / `shipped` / `shipping`（用作可用性声明） | 可用性声明 | 允许 "Not yet shipped" / "publicly shipped" |

## 禁止的具体 provider / 模型名

在 provider 目录证据未开放期间，公开文档不点名具体 provider 或模型：

| 禁止 | 模式 |
| --- | --- |
| `OpenAI` | 词边界 |
| `Anthropic` | 词边界 |
| `Claude`（作为 provider/模型） | 词边界；只允许在演示场景里以 "外部 AI 宿主" 出现 |
| `Gemini` | 词边界 |
| `GPT-`（带版本号） | 正则 |
| `Llama` | 词边界 |
| `DeepSeek` | 词边界 |
| `Mistral` | 词边界 |
| `Qwen` | 词边界 |
| `Ollama` | 词边界 |
| `vLLM` | 词边界 |
| `Cohere` | 词边界 |
| `Groq` | 词边界 |
| `Bedrock` | 词边界 |
| `Azure`（作为 AI provider） | 词边界 |

Runtime providers-and-models 页里那一处反向姿态的 `provider names` 是允许的，因为它是拒绝短语而不是名字。

## 禁止的前置承诺声明

| 声明 | 允许的替代 |
| --- | --- |
| 对已定义但未上线的面声明 "X is available now" | "X 在契约层已准入" |
| "X is GA" | "X 已准入契约证据" |
| "X is stable" | "X 是已定义面" |
| "今天就可以把 X 用于生产" | "X 已准入；生产姿态依赖证据" |

## 方法论侧的禁止捷径

Nimi Coding 拒绝以下命名反模式。描述 Nimi Coding 的公开文档不能声称使用了任何一项：

| 键 | 拒绝的模式 |
| --- | --- |
| `mvp_subset_contract` | 把规范契约真相砍成临时最小子集 |
| `legacy_alias` | 用软别名延续过时语义 |
| `compat_shim` | 用临时兼容代码遮盖归属切割 |
| `dual_read` | 两条未显式准入的并行真相读路径 |
| `dual_write` | 两条未显式准入的并行真相写路径 |
| `placeholder_success` | 在缺失真相时假装成功或闭合 |
| `happy_path_only_closure` | 仅完成 happy path 就宣告闭合 |
| `time_phased_layering` | 用时间切片（v1/v2/v3）替代语义分层 |
| `app_local_shadow_truth` | App 本地便利状态变成隐式规范真相 |
| `silent_owner_cut_reopen` | 在下游执行 wave 中重开归属域真相 |

## 检测

wave 级 grep 用来核验公开文档：

```bash
grep -rEn 'TODO|TBD|FIXME|coming soon|lorem|placeholder' \
  README.md docs/*.md docs/**/*.md

grep -rEni '^[^>]*\b(curl |npm install|pnpm install|brew install|apt-get install|yarn add|early.?access)' \
  README.md docs/*.md docs/**/*.md

grep -rEni '\b(OpenAI|Anthropic|Claude|Gemini|GPT-[0-9]|Llama|DeepSeek|Mistral|Qwen|Ollama|vLLM|Cohere|Groq|Bedrock|Azure)\b' \
  README.md docs/*.md docs/**/*.md
```

非空匹配（排除引用 / 拒绝语境内的反向姿态）即说明引入了一条禁止声明。

## Source Basis

- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/runtime/kernel/model-catalog-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/model-catalog-contract.md)
- [`.nimi/spec/runtime/kernel/provider-health-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/provider-health-contract.md)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
