# Catalog Source README

## 1. Purpose

`runtime/catalog/source/` stores **human-maintained source catalogs**.
`runtime/catalog/providers/*.yaml` stores **runtime-consumed generated snapshots**.

Source files are for maintainability.
Generated snapshots are for strict runtime compatibility.

## 2. File Roles

- `runtime/catalog/source/providers/*.source.yaml`
  - Source of truth for editor workflows.
  - Can use references and compact structures.
- `runtime/catalog/providers/*.yaml`
  - Generated, flattened provider catalogs.
  - Runtime resolver reads this format directly.
  - Do not hand-edit.

## 3. Core Contract (Current)

### 3.1 Model Strategy

- Use canonical model IDs in `models`.
- Historical/snapshot model IDs are represented by `aliases`.
- Resolver/generator should map alias -> canonical model.

### 3.2 Voice Strategy

- `models` reference `voice_sets` (`voice_set_ref`) by default.
- `models` may inline a `voice_set` only when needed (one-off exceptions).
- Avoid reverse mapping style (`voice -> model_ids`) in source files.

### 3.3 Language Strategy

- `langs` belongs to `voice_set` (or inlined model voice_set), not individual voice entries.
- `voice` entries do not define per-voice `langs`.
- If provider data implies voice-level language divergence under the same set, treat it as unsupported complexity and fail validation/generation.

## 4. Schema Conventions

### 4.1 `voice_sets` language declaration (oneOf)

Only one of the following is allowed:

- `langs_ref: <lang_set_id>`
- `langs: [zh-cn, en-us, ...]`

Both present or both missing is invalid.

### 4.2 `models` voice-set declaration (oneOf)

Only one of the following is allowed:

- `voice_set_ref: <voice_set_id>`
- `voice_set: { langs_ref|langs, source_ids, voices }`

Both present or both missing is invalid.

## 5. Required Validation Rules

At minimum, generator/schema validation must enforce:

1. Canonical `model_id` uniqueness.
2. `alias` uniqueness across all models.
3. Alias must not collide with canonical IDs.
4. `voice_set_id` uniqueness.
5. `voice` uniqueness inside each voice_set (case-insensitive recommended).
6. All `langs_ref` and `voice_set_ref` targets must exist.
7. `sources` references (`source_ids`) must exist.
8. oneOf constraints in sections 4.1/4.2.

## 6. DashScope Policy (Current)

For `dashscope.source.yaml`:

- Canonical models are:
  - `qwen-tts`
  - `qwen3-tts-instruct-flash`
  - `qwen3-tts-flash`
- Snapshot/history IDs live in each model `aliases`.
- Three voice sets are used:
  - `tts_voice_set`
  - `instruct_flash_voice_set`
  - `flash_voice_set`

## 7. Workflow

1. Edit `runtime/catalog/source/providers/<provider>.source.yaml`.
2. Run generator to produce `runtime/catalog/providers/<provider>.yaml`.
3. Run validation (schema + semantic checks).
4. Keep generated snapshot and source in sync.

## 8. Non-goals

- Do not encode provider-specific edge behavior in runtime resolver logic.
- Do not keep duplicated editable sources (single source-of-truth per provider).
- Do not hand-maintain snapshot files long-term.
