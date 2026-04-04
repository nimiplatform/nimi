# ParentOS (成长底稿) AGENTS.md

> Authoritative module-level instructions for AI agents working on ParentOS.

## Identity

- **App name (Chinese)**: 成长底稿
- **App name (English)**: ParentOS
- **App ID**: `app.nimi.parentos`
- **One-line**: AI 驱动的儿童成长操作系统——会主动告诉家长这个阶段孩子最该关注什么。
- **Status**: Pre-Alpha, not yet launched.

## Architecture

| Layer | Technology | Location |
|-------|-----------|----------|
| Desktop shell | Tauri 2 | `src-tauri/` |
| Frontend | React 19 + Vite 7 + Tailwind 4 | `src/shell/renderer/` |
| Local storage | SQLite (rusqlite, bundled) | `src-tauri/src/sqlite/` |
| AI | nimi runtime (`runtime.ai.text.generate`) | via `@nimiplatform/sdk` |
| UI components | `@nimiplatform/nimi-kit` | workspace dependency |
| State | Zustand | `app-shell/app-store.ts` |
| Charts | recharts | growth curves |
| Dev port | 1426 | vite.config.ts |

## Spec Authority & Sync

`spec/**` is the highest normative source. **When spec and code conflict, spec wins — fix the code, not the spec.**

Before making any change:
1. Read `spec/INDEX.md` — match the question to a reading path.
2. Read kernel YAML tables — these are structured facts.
3. Read source code ONLY to verify or fill gaps.

### Key Tables

| Table | Governs |
|-------|---------|
| `reminder-rules.yaml` | All reminder rules (vaccines, checkups, vision, dental, bone age, growth, sensitivity, interests, etc.) |
| `milestone-catalog.yaml` | Developmental milestones by domain and age |
| `sensitive-periods.yaml` | Montessori sensitive period definitions |
| `observation-framework.yaml` | 21 observation dimensions from 8 theories + relationship quality |
| `ability-model.yaml` | Ability-interpretation design asset; current layer count/enums are not yet frozen and must not be treated as a stable public contract |
| `growth-standards.yaml` | WHO growth curve reference data |
| `knowledge-source-readiness.yaml` | Authoritative reviewed / needs-review gate for what may enter Phase 1 AI free-form prompt |
| `nurture-modes.yaml` | Three nurture mode parameters |
| `local-storage.yaml` | SQLite schema (19 tables) |
| `routes.yaml` | Application routes |
| `feature-matrix.yaml` | Feature phasing (Phase 1-3) |

### Sync Rules

Any code change that touches spec-governed surfaces must follow:

```
Rule → Table → Generate → Check → Evidence
```

1. Modify the YAML table or contract first.
2. Regenerate compiled TS constants via the app-level knowledge-base generate step (`pnpm --filter @nimiplatform/parentos generate:knowledge-base`) once that script is landed in this package.
3. Run the app-level consistency check (`pnpm --filter @nimiplatform/parentos check:spec-consistency`) once that script is landed in this package.
4. Update code (migrations, routes, types) to match.
5. Run full test suite.

**Drift = CI failure.** The following mismatches are blocking:
- `local-storage.yaml` columns ≠ `migrations.rs` SQL
- `routes.yaml` paths ≠ `routes.tsx` route definitions
- `reminder-rules.yaml` ruleIds ≠ compiled TS constants
- `nurture-modes.yaml` parameters ≠ `app-store.ts` types
- `observation-framework.yaml` dimensionIds ≠ compiled TS constants

## Development Principles

### No Legacy, No Shims

This project starts from zero. There is no prior version, no deployed users, no data to migrate. Therefore:
- No compatibility layers, adapters, or shims.
- No "simple version first, fix later" shortcuts.
- No degraded schemas (string instead of enum, any instead of typed).
- No backward-compatible fallback logic.
- No deprecated code markers.
- Full schema, full knowledge base, full mode parameters from day one.

### Fail-Close

- Missing reminder rule match → error, not empty list.
- Knowledge base load failure → app does not start.
- AI output violating safety boundary → discard, not display.
- Missing nurture mode parameter → default to `balanced` (the only permitted fallback).

## Hard Boundaries

### AI Boundary

Two-layer model (boundary: whether individual data inference is involved):

- **Layer 1 (system does):** Evidence-based standardized reminders — rule-engine-driven timeline pushes from `reminder-rules.yaml` (rigid/stage categories), trend descriptions from recorded data, knowledge organization and explanation with source citation.
- **Layer 2 (system does NOT do, defer to professionals):** Individual diagnosis, treatment recommendations, mental health evaluation, comparative ranking.
- AI uses: "观察到", "可能", "倾向于".
- AI never uses: "落后", "异常", "危险", "警告", "发育迟缓", "障碍", "应该吃", "建议用药", "建议服用", "推荐治疗".
- Data anomaly → describe objective data + "建议咨询专业人士", no causal interpretation.
- Domains marked `needs-review` in `knowledge-source-readiness.yaml` must not enter Phase 1 free-form prompt.
- Full AI boundary spec: `spec/parentos.md` Section 6.2.

### Nurture Mode Boundary
- P0 reminders are ALWAYS `push` in ALL modes. No exceptions.
- Modes only control P1-P3 visibility, content depth, AI analysis detail.
- Modes never change medical/developmental safety thresholds.

### Privacy Boundary (PIPL Compliance)
- All data stored locally in SQLite. No cloud upload. No third-party SDK data collection.
- AI conversation `contextSnapshot` freezes at send time — contains only current-session child profile summary.
- No user data leaves the device. No device ID, location, contacts, or biometrics collected.
- Child profile deletion cascades to all associated records (growth, vaccine, journal, AI conversations, reminder states).
- Full privacy spec: `spec/parentos.md` Section 9.

## Verification

The following are the required verification targets for this app. If any app-level script entrypoint is still missing from `package.json`, land that script before treating the check as green:

```bash
# Spec layer
pnpm --filter @nimiplatform/parentos check:spec-consistency
pnpm --filter @nimiplatform/parentos check:knowledge-base
pnpm --filter @nimiplatform/parentos check:nurture-mode-safety

# Code layer
pnpm --filter @nimiplatform/parentos typecheck
pnpm --filter @nimiplatform/parentos test
pnpm --filter @nimiplatform/parentos lint

# Rust layer
cd apps/parentos/src-tauri && cargo test
cd apps/parentos/src-tauri && cargo check
```

### Knowledge Base Validation

`check:knowledge-base` verifies constraints defined in each YAML table's `constraints` field:
- ruleId/milestoneId/periodId/dimensionId uniqueness and pattern matching
- P0 push constraint across all nurture modes
- `triggerAge` range validity
- `category=personalized` requires `triggerCondition`
- `alertIfNotBy > typicalAge.rangeEnd`
- Sensitive period `startMonths < peakMonths < endMonths`

## Retrieval Defaults

Start with: `spec/kernel/tables/`, `src/shell/renderer/engine/`, `src/shell/renderer/app-shell/`, `src-tauri/src/sqlite/`.

Skip: `node_modules/`, `dist/`, `target/`, lockfiles.

## Code Conventions

- ULID for all new IDs (not UUID).
- ISO 8601 for all date/time fields.
- JSON serialized as TEXT in SQLite.
- `childId` is the primary filter for most queries.
- ESM imports use `.js` extension even for `.ts` files.
- Shared Tauri modules imported via `#[path = "..."]` from `shared-tauri/` and `forge/`.
