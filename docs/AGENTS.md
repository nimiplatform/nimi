# docs/ — Authoring Rules

This file is for contributors writing or editing pages under `docs/`.
It is **not** part of the published site — VitePress doesn't render it,
and readers don't see it.

These rules govern how docs pages are written. They are deliberately
kept out of the published prose because readers come to docs to learn
the product, not to learn how the docs are organized.

## What docs/ Is For

The docs site explains Nimi to humans:
- What the platform is.
- What each product inside the platform does.
- How concepts (worlds, agents, contracts, ownership) fit together.
- Concrete reader scenarios.
- Source Basis links back to `.nimi/spec/**` for traceability.

That's it. Readers don't need to read about how we govern our docs.

## What Doesn't Belong In Pages

The following classes of content are **not allowed** in
reader-facing prose. If you find yourself writing one of these,
move it here (this file) or to `.nimi/methodology/`, not into
`docs/`.

### 1. Self-referential governance segments

Any heading along the lines of:
- "What This Page Does Not Claim"
- "Public Boundary"
- "Public Posture"
- "本页不主张什么"
- "公开边界"
- "公开姿态"

These were systematically removed in wave-8. Do not reintroduce
them.

### 2. Internal product roadmap intent

Sentences explaining *why* a section is deeper or thinner than
others, e.g.:
- "Currently the most extensively written-out section because it
  is actively used and pitched."
- "这一节当前写得最完整，因为正在做对外推广。"

The section content speaks for itself. We don't tell readers
which section we care about more.

### 3. docs-vs-spec meta

Sentences explaining how the docs relate to `.nimi/spec/**`,
e.g.:
- "These docs are derived from `.nimi/spec/**`."
- "If a docs page disagrees with the spec, the spec wins."
- "中文文档与英文规范的关系..."
- "When These Docs Disagree With The Spec"
- "Authority Model" (the README section about docs vs spec).

Source Basis tail links *do* belong on every page (they are
useful references). Prose explaining "why we have a Source
Basis" does not.

### 4. Pre-launch posture explanations

Sentences explaining why we don't publish install commands /
provider names / release dates, e.g.:
- "These docs are pre-launch. They do not publish unverified
  install commands..."
- "中文文档不会发布尚未取得证据的安装命令..."
- "What's Not Here Yet"

The fact that those things aren't there is enough. Readers don't
need an explanation for the absence.

### 5. Reading-style explanations

Sentences explaining how to read the docs, e.g.:
- "Each page opens with reader-facing prose explaining what the
  page is about and at least one concrete scenario."
- "Source contracts are grouped at the end of pages under Source
  Basis."
- "How To Read These Docs"

Just write the page well. Don't explain the writing style.

## What Does Belong In Pages

- Direct product explanation: what a thing is, what it does, how
  it relates to other things.
- Reader scenarios: concrete walked-through examples.
- Tables / fields / state machines when appropriate.
- Source Basis tail with GitHub /blob/main/ links to
  `.nimi/spec/**` and admitted package source paths.

## Audience Calibration

- **User-facing pages** (section index pages, Nimi Coding
  paradigm narrative, Reader Scenarios across all pages, Start,
  Glossary): tilt more conversational. Short sentences.
  Plain language. Avoid governance jargon.
- **Developer-facing pages** (SDK boundaries, kernel-anchored
  sub-pages, Reference dictionary entries, Architecture
  sub-tree): preserve technical precision. Drop only the
  formal-shell overhead, not the technical content.
- **Mixed pages** (Realm, Avatar, Cognition, Desktop): top
  paragraphs more conversational; contract-listing tables
  preserved as-is.

## Term Mapping (zh ↔ en)

When writing or revising zh pages, use this approved mapping:

| English | 中文 |
| --- | --- |
| World | 世界 |
| Agent | Agent |
| Realm | Realm (product name) |
| Runtime | Runtime |
| Cognition | Cognition |
| Avatar | Avatar |
| Nimi Coding | Nimi Coding (product name) |
| SDK | SDK |
| Platform | 平台 |
| Desktop / Web | 桌面端 / 网页端 |
| spec | 规范 |
| authority | 权威 / 权威来源 |
| skill | 技能 |
| host / host-agnostic | 宿主 / 宿主无关 |
| workflow | 工作流 |
| open world | 开放世界 |
| primitive | 基础协议 |
| projection | (rewrite around it; don't transliterate as 投影 / 投射 in body prose) |
| Personas | 用户画像 |

zh content is original Chinese, **not** sentence-by-sentence
translation of English. Facts must stay consistent with
`.nimi/spec/**`.

## Source Basis Convention (wave-5 lock)

Every page ends with a `## Source Basis` section. Each ref line
is a markdown link of shape:

```
- [`<relative path>`](https://github.com/nimiplatform/nimi/blob/main/<path>)
```

Do not link to `.nimi/topics/**` (those are internal-lifecycle
artifacts) or to `design/` (topic-internal preflight artifacts).

## When You Need To Document A Principle

If a principle is genuinely useful for someone *building* Nimi
or *adopting* Nimi Coding (the methodology), it belongs in
`.nimi/methodology/` or `.nimi/contracts/`, not in `docs/`.

If a principle is for docs contributors (like the rules above),
it belongs here in `docs/AGENTS.md`.

If a principle is for the broader codebase, see the closest
module's `AGENTS.md`.

The published `docs/` site stays focused on the reader. The
governance lives where authors and contributors look for it.

## Translation-Tic Anti-Patterns (zh writers)

zh content must read as native original Chinese, not as
sentence-by-sentence translation of en source. The patterns below
are **forbidden** in body prose and are detectable via grep. Any
zh-writing wave's closeout must include the T-suite grep output as
verification evidence.

### Strict-zero patterns (target = 0 hits across docs/zh/**)

| ID | Regex | What it indicates | Rewrite around |
| --- | --- | --- | --- |
| T1 | `发货\|出货` | "ships as / ships with" forced onto software distribution | "以 ... 形式分发", "公开为 ...", "装到任何仓库", "可独立装的 npm 包", direct rewrite |
| T3 | `落到\|落地为\|落地在` | "lands at / lands as / lands on" verb calque | "落在 ... 里", "归在 ...", direct rewrite |
| T4 | `跟着[^，。\s]{0,15}走` | "follows X / follows along with X" | "按 X 来", "顺着 X", direct rewrite |
| T6 | `叫 done\|就 done\|叫做 done` | "calls it done" mid-sentence English token | "算完成", "就算 done 了 → 就算了完事", direct rewrite |
| T8 | `被[^，。\s]{1,15}拥有的` | "owned by X" English relative clause direct render | "X 拥有的 Y" (drop the 被), or rewrite |

### Soft-target patterns (target reduced; remaining hits enumerated and justified)

| ID | Regex | What it indicates | Notes |
| --- | --- | --- | --- |
| T2 | `被[^，。；！？\s]{1,15}为` | "is admitted as / is treated as / is recognized as" | Some legitimate technical uses survive ("被准入为" in contract context); enumerate remaining hits in closeout |
| T5 | `把[^，。；！？\s]{1,20}(当作\|作为)` | "treats X as Y" verb-as-Z complement | Target ≤ 5 across docs/zh/; each remaining hit must be deliberate |
| T7 | ` — ` (em-dash count per page > 10) | Anglo punctuation density | Reduce to ≤ 10 per page unless table content justifies more |
| T9 | leading `^[^，。]{1,30}之前\b` | English temporal clause fronting | 0 in narrative prose; table cells acceptable |

### Mid-strength patterns (advisory; reduce density)

| ID | Regex | Indicates |
| --- | --- | --- |
| T10 | `主张[很\|是]?简单` | "the claim is simple" rhetorical opener |
| T11 | `跑个 [^，。]+测试\|跑过 [^，。]+测试` | "run a test" verb-particle calque (acceptable in some dev contexts; reduce blanket use) |
| T12 | `这个模型崩\|这条路崩` | "this model breaks down" → 崩 calque |
| T13 | `就[^，。]{1,10}叫\b` | "just call X" colloquial calque |

### What this section governs

zh content is original Chinese, not sentence-by-sentence translation
of en. Facts must stay consistent with `.nimi/spec/**` and the en
source. When the en source uses a sentence shape that maps awkwardly
into Chinese, the zh page must rewrite around it, not transliterate.
Em-dash insertions are a soft signal: occasional use is fine, but a
page with more than 10 em-dashes is almost always a sign of direct
porting from en.

A zh-writing wave that claims "原创中文" or "B 中文原创" must include
the T-suite grep output in its closeout. The closeout must enumerate
any soft-target pattern hits with per-hit justification. A closeout
without grep evidence is a `placeholder_success` shortcut and is
not accepted.
