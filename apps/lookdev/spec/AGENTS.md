# Lookdev Spec AGENTS

## Authoritative Structure

- `lookdev.md`: app-level product overview and cross-repo boundary summary
- `INDEX.md`: reading order
- `kernel/*.md`: normative app contracts
- `kernel/tables/*.yaml`: authoritative fact sources for states, fields, routes, and policies

## Rule ID Namespace

- `LD-SHELL-*` — standalone app shell, top-level surfaces, navigation
- `LD-BATCH-*` — batch and item model, lifecycle, state ownership
- `LD-PIPE-*` — processing flow, retry flow, pause/resume, commit stages
- `LD-EVAL-*` — auto-evaluation gate and result structure
- `LD-WRITE-*` — Realm writeback boundary and commit semantics
- `LD-CAP-*` — typed capability usage and app/runtime/realm boundaries

## Editing Rules

1. Tables in `kernel/tables/*.yaml` win over prose when enumerations or field lists are involved.
2. Product docs must not redefine Realm truth. Lookdev owns app-local batch working state only.
3. Do not invent a local replacement for Realm binding law. Lookdev may target upstream Realm agent presentation bindings, but it must not redefine binding legality inside this spec tree.
4. Do not collapse Lookdev back into a mod-style single-user draft tool. This spec defines a standalone batch control-plane app.
5. Do not turn Lookdev into a generic asset market, agent editor, or avatar cropper. First-version writeback is limited to confirmed portrait truth.
6. Keep batch policy semantics centralized at batch scope. First version must not introduce per-item model or rubric overrides.

## Fact Sources

- `kernel/tables/routes.yaml` — shell routes and surface map
- `kernel/tables/batch-model.yaml` — batch/item fields, states, snapshots, and defaults
- `kernel/tables/evaluation-rubric.yaml` — hard gates, scored checks, and evaluation payload shape
- `kernel/tables/writeback-policy.yaml` — Realm commit target and replacement rules
