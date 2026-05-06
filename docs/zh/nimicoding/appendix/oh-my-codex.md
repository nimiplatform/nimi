# 附录：oh-my-codex 适配器

`oh-my-codex` 是包附带的一个 admitted 外部执行 host adapter overlay。它演示一个特定 host 怎么以受约束桥的身份被准入，而**不**变成语义拥有者。

这页是**附录**，**不是**一等概念。方法学是宿主无关的；oh-my-codex 是 admitted overlay 的一个例子。其他 host overlay 能跟相同模式。

## Overlay 提供什么

| 文件 | 用途 |
| --- | --- |
| `adapters/oh-my-codex/profile.yaml` | `oh-my-codex` 作为 host 的 admitted overlay profile |

Overlay 声明：

- `oh-my-codex` 以受约束桥的身份被准入。
- 它满足哪些 host-class 能力。
- 包准入的任何 host 特定路由细节。

关键是它**不**声明语义拥有；方法学核保持厂商中立。

## 何时用

用 `oh-my-codex` overlay 当：

- 你的项目用 `oh-my-codex` 作为技能 dispatch 的 AI host。
- 你想 `nimicoding doctor` 输出里有命名 overlay 元数据（vs 通用外部 host profile）。

## 何时不用

用通用外部 host profile（无 overlay）当：

- 你的项目直接用 admitted host（Claude / Codex / Gemini 等）。
- 你**不**需要超出厂商中立 profile 的 host 特定路由细节。

包的设计承诺：任何遵循合同的 host 能用；命名 overlay 是便利、**不是**要求。

## 阅读场景：从 oh-my-codex 换到别的 host

你的项目一直用 `oh-my-codex`。你想换到不同 admitted host。

| 步骤 | 动作 |
| --- | --- |
| 方法学改动 | 无 — 包源不变 |
| Adapter 改动 | 可选移除 `oh-my-codex` overlay 如不再用；或留着作文档 |
| 新 host | 用通用外部 host profile 或如需要写新 adapter overlay |
| 既有工件 | `oh-my-codex` 跑下的 topic / wave / packet / closeout 记录留有效 |

方法学的可移植性正是价值。换 host **不**让过去工作失效。

## 阅读场景：加新 host adapter

假设你想给一个叫「host-x」的 host 加 overlay。

| 步骤 | 动作 |
| --- | --- |
| 建 `adapters/host-x/profile.yaml` | 跟 `oh-my-codex` overlay 形状 |
| 声明 host-class 能力 | Host 满足哪些必需的 |
| 声明硬约束满足 | 厂商中立、无本地 runtime、无编排拥有 |
| 记录 host 特定路由细节 | 只 admit 不漏进方法学核的 |
| 用 `nimicoding doctor` 测 | 校验兼容 |

被准入后，新 adapter 跟 `oh-my-codex` 一起可用。包支持多个 admitted overlay；你按项目上下文挑用哪个。

## 适用边界

`oh-my-codex` 不是唯一 admitted 外部执行 host、首选 host、或采纳必需项。它是 overlay 形状的一个例子；其他 admitted host 可以采用同一类桥接方式。

这页只讲 Nimi Coding adapter overlay，不替 `oh-my-codex` 本身写工具文档。

## 来源

- [`nimi-coding/adapters/oh-my-codex/profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/adapters/oh-my-codex/profile.yaml)
- [`nimi-coding/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-adapter.yaml)
- [`nimi-coding/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/external-host-compatibility.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-runtime.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
