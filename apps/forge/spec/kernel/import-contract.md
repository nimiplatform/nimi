# Import Contract — FG-IMPORT-*

> Status: Active | Date: 2026-03-19

## Overview

The Import module adds two external content import pipelines to Forge:
1. **Character Card V2 JSON** — parse + source-fidelity capture + rule mapping + review + publish
2. **Novel Text** — chapter split + local extraction + progressive accumulation + review + publish

Import uses a dual-track model:
- **Rule Truth Track** — emits `WorldRule` + `AgentRule` drafts aligned with realm truth APIs
- **Source Fidelity Track** — preserves raw external import evidence locally for audit, replay, and future re-export

## Rules

### FG-IMPORT-001 — Character Card V2 Import Pipeline

The Character Card V2 import pipeline SHALL:
1. Accept `.json` files conforming to `chara_card_v2` spec (spec_version `2.0`).
2. Reject V1 cards (missing `spec` field) with an explicit error message.
3. Preserve raw JSON, normalized V2 payload, unknown root/data fields, `extensions`, and CharacterBook evidence in a local source-fidelity manifest before rule mapping.
4. Map persona/runtime-facing V2 fields to `AgentRule` drafts across the 4 layers `DNA | BEHAVIORAL | RELATIONAL | CONTEXTUAL`.
5. Map weak world-facing V2 fields such as `scenario`, source tags, and world-facing CharacterBook entries into low-hardness `WorldRule` seed drafts.
6. Classify CharacterBook entries as `WorldRule` or `AgentRule` via local LLM-assisted classification using `createForgeAiClient().generateText()`.
7. Fall back to conservative all-AgentRule classification if trusted world classification is unavailable.
8. Allow user override of CharacterBook classification results before publishing.
9. Require a target world before publishing canonical rule truth, so import does not create partial agent records without rule truth.

### FG-IMPORT-002 — Novel Text Import Pipeline

The Novel Text import pipeline SHALL:
1. Accept `.txt` / `.md` text files up to 10MB.
2. Split text into chapters using heading detection (Chinese `第X章/节/回` and English `Chapter X`), falling back to fixed-size chunking (3000 chars, 300 overlap).
3. Preserve raw source text, chapter chunks, chapter extraction artifacts, conflict decisions, and final rule lineage in a local source-fidelity manifest.
4. Process chapters sequentially, sending each to the local runtime AI with accumulated world and character context.
5. Maintain a progressive accumulator keyed by stable canonical `ruleKey` values, not by LLM-generated timestamps or per-run random identifiers.
6. Canonicalize rule identity locally from domain/layer plus semantic anchors such as subject key and semantic slot.
7. Detect cross-chapter contradictions and classify them as auto-resolvable or human-required.
8. When a human resolves a contradiction, write the decision back into accumulator truth and lineage before final publish.
9. Support two extraction modes: Auto (all chapters, review at end) and Manual (pause per chapter).
10. Persist accumulator state to localStorage for crash recovery.
11. End in a local reviewable draft state; publish happens only after explicit user confirmation.
12. When publishing world creation, only the minimal publish candidate may be sent to Realm draft storage; extraction workflow state stays local.

### FG-IMPORT-003 — Source Fidelity Manifest

Each import session SHALL maintain a local source-fidelity manifest:
- Character Card manifest includes raw JSON, normalized V2 payload, unknown fields, `extensions`, CharacterBook entries, and classification outcomes
- Novel manifest includes raw source text, chapter chunks, extraction artifacts, conflict records, and final rule lineage
- The manifest is non-normative to realm truth and does not replace `WorldRule` / `AgentRule`
- The manifest exists to support audit, replay, future export, and safer re-mapping

### FG-IMPORT-004 — Shared Output Shape

Both pipelines SHALL produce output conforming to `LocalImportResult`:
- `worldRules: LocalWorldRuleDraft[]` — aligned with `CreateWorldRuleDto`
- `agentRules: LocalAgentRuleBundle[]` — each bundle has `characterName` + `rules: LocalAgentRuleDraft[]` aligned with `CreateAgentRuleDto`
- `metadata: ImportMetadata` — source type, filename, timestamp, version

### FG-IMPORT-005 — No Backend Changes

The Import module SHALL NOT require new backend endpoints. All publishing uses existing APIs:
- `POST /api/creator/agents` (single create)
- `POST /api/creator/agents/batch-create` (batch create)
- `POST /api/world/by-id/{worldId}/rules` (world rule)
- `POST /api/world/by-id/{worldId}/agents/{agentId}/rules` (agent rule)
- `POST /api/world-drafts` + `POST /api/world-drafts/{draftId}/publish` (world creation)

### FG-IMPORT-006 — Local-First Processing

All import parsing, LLM extraction, and conflict resolution SHALL execute locally via `@nimiplatform/sdk/runtime`. Backend is only contacted when the user explicitly triggers publish.

### FG-IMPORT-007 — Workspace Orchestration

The Import session store SHALL remain its own local Zustand state for parser/extraction task progress, but import output SHALL be written back into the outer `ForgeWorkspaceStore` before review and publish.

This means:
- import execution state may remain transient and session-local
- canonical review drafts do **not** stay inside `useImportSessionStore`
- Character Card and Novel imports both end by updating the current workspace review state
- publish reads the unified workspace draft truth, not the import page's transient local state
- Realm `world-drafts` receive only the final minimal candidate payload, not parser/extractor workflow internals

### FG-IMPORT-008 — Publish Safety

Import publish SHALL preserve truth consistency:
1. Character Card import must not create a standalone agent without canonical rule truth.
2. Character Card import must require a target world before publishing world-bound rules and the imported agent.
3. Novel import publish order is `world draft/publish -> agents -> world rules -> agent rules`.
4. Final publish payload must reflect the post-review, post-conflict-resolution draft state rather than raw extraction output.

## Module Structure

```
features/import/
├── types.ts                         # Shared types + manifest types
├── state/
│   ├── import-session-store.ts      # Zustand store
│   └── novel-accumulator.ts         # Progressive accumulator + lineage
├── engines/
│   ├── character-card-parser.ts     # V2 JSON parse + validate + raw preservation
│   ├── character-card-source-manifest.ts # Source-fidelity manifest assembly
│   ├── character-card-mapper.ts     # V2 → AgentRule[] / weak WorldRule[] seeds
│   ├── character-book-mapper.ts     # CharacterBook → WorldRule/AgentRule mapping
│   ├── novel-chunker.ts             # Chapter-aware text splitting
│   ├── novel-extraction-engine.ts   # Per-chapter local extraction
│   ├── novel-conflict-resolver.ts   # Cross-chapter conflict resolution
│   ├── novel-prompts.ts             # Local extraction prompt templates
│   └── rule-key-canonicalizer.ts    # Stable canonical rule identity
├── data/
│   └── import-publish-client.ts     # Backend push + publish guards
└── hooks/
    ├── use-character-card-import.ts # Character Card orchestration
    └── use-novel-import.ts          # Novel orchestration
```

## Routes

See `kernel/tables/routes.yaml` for authoritative route definitions. The only canonical import routes are:
- `/workbench/:workspaceId/import/character-card`
- `/workbench/:workspaceId/import/novel`

## Feature Matrix

See `kernel/tables/feature-matrix.yaml` for phase/priority assignments.
