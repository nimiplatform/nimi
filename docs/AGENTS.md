# docs/ — Authoring Rules

This file is for contributors writing or editing pages under `docs/`.
It is **not** part of the published site — VitePress doesn't render it,
and readers don't see it.

These rules govern how docs pages are written. They are deliberately
kept out of the published prose because readers come to docs to learn
the product, not to learn how the docs are organized.

## What docs/ Is For

The docs site primarily helps ecosystem developers build third-party Nimi Apps:
- The prerequisites, commands, and results for creating and running an App.
- How to use the public SDK, configure access, and diagnose real failures.
- The concepts and ownership boundaries needed for the reader's current task.
- The difference between local development, installation, access, and public distribution.
- Source Basis links back to `.nimi/spec/**` for traceability.

That's it. Readers don't need to read about how we govern our docs.

## What Doesn't Belong In Pages

The following classes of content are **not allowed** in
reader-facing prose. If you find yourself writing one of these,
move contributor instructions here (this file). Product semantics
belong only in `.nimi/spec/**`, not in `docs/`.

### 1. Self-referential governance segments

Any heading along the lines of:
- "What This Page Does Not Claim"
- "Public Boundary"
- "Public Posture"
- "本页不主张什么"
- "公开边界"
- "公开姿态"

These sections are forbidden. Do not reintroduce them.

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

Omit commentary about the documentation process. Still state actual missing
prerequisites, unavailable capabilities, platform limits, and release status
when they affect the reader's next action; give the applicable next step.

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

- **Start and task guides:** help a developer reach the next real result.
  Explain unfamiliar prerequisites where they matter, and keep commands aligned
  with the public version the guide addresses. Do not substitute workspace
  versions for released packages.
- **SDK, API, architecture, and advanced configuration references:** preserve
  technical precision, exact fields, errors, permissions, and ownership.
  Technical vocabulary is useful when it serves the task.
- **Product overviews:** explain purpose first, then link to the relevant
  developer task or reference. Ordinary product download and usage information
  can point to the public site without turning developer guides into marketing.
- Distinguish learning a tool from a real toolchain dependency. The generated
  App's nimicoding dependency and explicit initialization remain valid; they do
  not require the reader to first study Nimi's internal governance workflow.

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

## Source Basis Convention

Every page ends with a `## Source Basis` section. Each ref line
is a markdown link of shape:

```
- [`<relative path>`](https://github.com/nimiplatform/nimi/blob/main/<path>)
```

Do not link reader-facing pages to task execution-state or planning
artifacts. Historical evidence belongs in Git history; active Source
Basis links point to canonical `.nimi/spec/**`, admitted package source,
or current implementation surfaces. The managed
`.nimi/methodology/authority-authoring.yaml` guide may be linked only
when the page is specifically about authority authoring.

## When You Need To Document A Principle

If a principle changes product semantics, it belongs in canonical
`.nimi/spec/**`. Nimi Coding host settings belong in `.nimi/config/**`.
Do not create another methodology or contract document to restate
either one.

If a principle is for docs contributors (like the rules above),
it belongs here in `docs/AGENTS.md`.

If a principle is for the broader codebase, see the closest
module's `AGENTS.md`.

The published `docs/` site stays focused on the reader.

## Chinese Writing Review

Write natural Chinese while preserving the English page's facts and canonical
authority. Check whether the intended reader can follow the instructions and
understand the result. Keep technical terms when the developer needs them.

Literal translations such as software being “发货”, awkward “被……拥有的”
phrases, or repeated English sentence structures are useful editing clues.
Judge them in their actual sentence; the presence of a word or punctuation
pattern does not establish a defect.

Use a lexical search only when it helps resolve a wording issue in the current
changed passages. There is no site-wide zero-hit target, count threshold,
unrelated-page cleanup, mandatory T-suite output, or per-hit justification
report. A claim of original Chinese does not require a grep receipt.

Missing lexical output is not pseudo-success. Verify factual accuracy,
applicable commands, and the affected reader task; report unexecuted paths
honestly. Lexical checks can assist this judgment but never replace it.
