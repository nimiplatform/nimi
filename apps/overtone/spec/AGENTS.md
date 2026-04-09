# Overtone Spec — AGENTS.md

## Scope
- Applies to `apps/overtone/spec/**`.
- This tree is a product spec for the Overtone demo app, not an implementation report.

## Editing Rules
- Keep the app name stable as `Overtone` unless the user explicitly renames it.
- Treat upstream contracts in `spec/runtime/**`, `spec/sdk/**`, and `spec/realm/**` as authoritative for runtime, SDK, and realm behavior.
- Do not describe an SDK or runtime surface as stable unless it is traceable to repo code or upstream spec.
- Product-facing expansion ideas belong here; execution evidence and delivery plans belong in `nimi-coding/.local/**`, not in the spec tree.
- Prefer phase labels `P0`, `P1`, `P2` over vague labels like "later" or "future".
- Keep Overtone app logic shallow: renderer business logic -> SDK -> runtime/realm. Do not spec an app-specific backend unless the user explicitly asks for one.

## Expected Structure
- `overview.md`: product positioning, naming, scope, non-goals.
- `architecture.md`: Tauri, renderer, SDK, runtime/realm boundary and data flow.
- `features.md`: tiered feature set with MVP vs optional extensions.
- `sdk-integration.md`: concrete SDK usage notes and risk boundaries.
- `execution-plan.md`: phased delivery plan; no execution evidence.
