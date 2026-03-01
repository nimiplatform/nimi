# Spec AGENTS.md

> Conventions for AI agents working under `spec/`.
> Root `AGENTS.md` still applies. This file adds spec-specific execution gates.

## Scope

Applies to all files under:

- `spec/runtime/**`
- `spec/sdk/**`
- `spec/desktop/**`
- `spec/future/**`
- `spec/platform/**`
- `spec/realm/**`

评估/审计/查询系统能力时，同样从 `spec/INDEX.md` 开始。

## Authoritative Structure

- `kernel/*.md`: cross-domain rule contracts (`K-*` / `S-*` / `D-*` / `F-*` / `P-*` / `R-*`).
- `kernel/tables/*.yaml`: structured fact sources (authoritative data layer).
- `kernel/generated/*.md`: generated views from YAML tables.
- `domain docs` (for example `spec/runtime/*.md`, `spec/sdk/*.md`, `spec/platform/*.md`, `spec/realm/*.md`): domain increments only, with rule references. Do not duplicate kernel prose.

## Editing Rules

- Do not manually edit `spec/**/kernel/generated/*.md`.
- When behavior/contract facts change, edit YAML tables first, then align kernel/domain references in the same change.
- Keep runtime and sdk boundaries explicit; do not silently mix deferred and in-scope services.

## Mandatory Verification Commands

Run commands based on changed scope. Template (replace `{domain}` with the affected domain):

```
pnpm check:{domain}-spec-kernel-consistency
pnpm check:{domain}-spec-kernel-docs-drift
```

If `spec/{domain}/kernel/tables/*.yaml` changed, also run generation first:

```
pnpm generate:{domain}-spec-kernel-docs
```

then rerun the corresponding `check:*docs-drift` command.

| Domain | Scope |
|--------|-------|
| runtime | `spec/runtime/**` |
| sdk | `spec/sdk/**` |
| desktop | `spec/desktop/**` |
| future | `spec/future/**` |
| platform | `spec/platform/**` |
| realm | `spec/realm/**` |

If multiple domains changed, run all affected domains' commands.

## Consistency Guard: Two-Layer Model

Spec 质量守护分两层，CI 是主层，LLM 审计是补充层。

### Layer 1 — CI Scripts (Deterministic, Mandatory)

一致性脚本是 spec 质量的主守护层。当前覆盖 72 条自动化验证规则：

| Domain | Script | Validates |
|--------|--------|-----------|
| Runtime | `check-runtime-spec-kernel-consistency.mjs` | Rule ID refs, YAML ↔ table parity, provider coverage, state machine completeness, RPC migration map, config traceability, metadata key cross-refs |
| SDK | `check-sdk-spec-kernel-consistency.mjs` | Rule ID refs, method groups, import boundaries, error code families |
| Desktop | `check-desktop-spec-kernel-consistency.mjs` | Rule ID refs, source code ↔ spec alignment (UI slots, hook points, lifecycle states, retry codes) |
| Future | `check-future-spec-kernel-consistency.mjs` | ID format, dependency cycles, graduation log, status consistency |
| Platform | `check-platform-spec-kernel-consistency.mjs` | Error code uniqueness, primitive completeness, compliance matrix, audit events, presets, profiles |
| Realm | `check-realm-spec-kernel-consistency.mjs` | Vocabulary domains, tier pricing monotonicity, event types, share plan fields, primitive mapping status |

**什么必须在 CI 脚本中检查（不允许仅靠 LLM 审计）：**

- 规则 ID 引用完整性（定义存在、引用可解析）
- YAML 事实源 ↔ 生成文档同步
- 枚举值/字段名一致性
- 命名格式与禁用名称
- 跨表引用对齐（如 provider-catalog ↔ provider-capabilities）
- 源码常量 ↔ spec 表对齐
- 依赖图合法性（无环、ID 存在）

**扩展脚本的时机：**

- 新增 kernel 规则引入了可自动化验证的约束 → 同 PR 补充脚本规则
- LLM 审计发现了确定性缺陷（如 YAML 缺条目、交叉引用断裂）→ 修复时必须补脚本防回归
- 新增 YAML 表 → 在对应 generate 脚本和 check 脚本中注册

### Layer 2 — LLM Audit (Semantic, Low-Frequency)

LLM 审计仅覆盖 CI 无法机器化的语义判断：

- 设计合理性（如健康探测策略是否正确、backoff 是否缺 jitter）
- 规格完整性（如约束是否用了"例如"而非完整枚举）
- 跨域语义一致性（如错误模型与流式契约的终帧语义是否互补）
- 过度设计 / 欠设计评估

**LLM 审计的约束：**

- 不可替代 CI 检查。LLM 不可复现、有遗漏、依赖上下文窗口。
- 审计发现中属于确定性规则类型的项，修复后必须补充 CI 脚本。
- 审计报告输出到 `dev/report/`，不嵌入 spec 文档本身。

## PR/Report Expectation

- Include the exact verification commands executed.
- Include pass/fail result for each command.
- If a command is not run, state why.
