# ParentOS Spec Audit Defer

Status: `deferred`
Owner: `app.nimi.parentos`
Updated At: `2026-04-11`
Reason: `ParentOS app-local authority formalization, spec realignment, and drift closure are complete for the currently admitted surfaces, but several implementation defects and one checker-hardening follow-up remain outside this audit's allowed edit scope or were intentionally deferred to a dedicated cleanup pass.`
Evidence Ref:
- `pnpm --filter @nimiplatform/parentos check:spec-consistency`
- `pnpm --filter @nimiplatform/parentos check:knowledge-base`
- `pnpm --filter @nimiplatform/parentos check:ai-boundary`
- `pnpm --filter @nimiplatform/parentos typecheck`
- `pnpm --filter @nimiplatform/parentos test`
- `cargo check` in `apps/parentos/src-tauri`
- `pnpm check:agents-freshness`

This file is tracking-only. It is not product authority. ParentOS authority remains under `apps/parentos/spec/kernel/*.md` and `apps/parentos/spec/kernel/tables/**`.

## Deferred Findings

| Severity | Item | Why Deferred | Evidence |
|---|---|---|---|
| high | Vaccine reminder placeholder writes future vaccine rows as a surrogate reminder | Explicitly classified as a defect that must not be canonized; requires product/runtime cleanup rather than spec catch-up | `src/shell/renderer/features/profile/vaccine-page.tsx:149` |
| high | Typed bridge coercion and field alias fallback in runtime defaults parsing | Explicitly classified as non-authoritative fail-open behavior; needs a fail-close bridge hardening pass | `src/shell/renderer/bridge/types.ts:38`, `src/shell/renderer/bridge/types.ts:60` |
| high | Runtime defaults fallback path still invents local defaults and loopback recovery | Explicitly classified as fail-open runtime/bootstrap behavior; outside this audit's spec-first closure scope | `src/shell/renderer/bridge/runtime-defaults.ts:17`, `src/shell/renderer/bridge/runtime-defaults.ts:51` |
| medium | Vision batch OCR silently swallows OCR failure | Explicitly classified as defect backlog; should fail closed with surfaced error, not be admitted into authority | `src/shell/renderer/features/profile/vision-batch-form.tsx:176` |
| medium | Orphan report history surface still queries unsupported `ocr-upload` report type | Explicitly classified as orphan/unrouted surface; should be removed or re-owned, not canonized | `src/shell/renderer/features/profile/report-history-page.tsx:92` |
| low | Drift checks remain source-text based rather than AST-based | Current checks are good enough for admitted surfaces and now pass, but longer-term hardening would reduce brittle string matching risk | `scripts/check-parentos-ai-boundary.ts`, `scripts/check-parentos-spec-consistency.ts` |

## Recommended Reopen Scope

Reopen this defer only when one of these scopes is intentionally frozen for execution:

1. `parentos-defect-cleanup-fail-close`
   Focus:
   - vaccine placeholder reminder writes
   - bridge coercion / field alias fallback
   - runtime default fail-open behavior
   - vision OCR silent swallow

2. `parentos-orphan-surface-cleanup`
   Focus:
   - orphan `report-history-page.tsx`
   - any additional unrouted or unowned profile/report surfaces

3. `parentos-drift-check-hardening`
   Focus:
   - replace string-fragile checks with more structural parsing where justified
   - extend authority tests if new AI/runtime surfaces are admitted

## Reopen Gate

Do not reopen merely to restate current findings. Reopen only if:

- a fix pass is approved for one of the deferred defect classes above
- ParentOS implementation adds new AI/runtime surfaces outside the current admitted allowlists
- the current source-text drift checks start producing false negatives or recurring false positives

## Closeout Snapshot

Closed by defer after:

- app-local authority landing was formalized under `apps/parentos/spec/kernel/**`
- profile-local AI summaries and medical-event AI adjuncts were admitted into spec authority
- `PO-FEAT-022` was realigned to the actual `runtime.ai.text.generate` implementation path
- spec consistency and AI boundary checks were expanded and verified green
- authority/tests/docs were aligned without changing ParentOS business behavior
