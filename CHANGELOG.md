# Changelog

All notable changes to this repository are documented in this file.

The format follows Keep a Changelog and Semantic Versioning.

## [Unreleased]

### Changed (breaking, `@nimiplatform/sdk` Realm)

- Public world discovery is paginated on Realm. `worldPublicControllerListWorlds`
  and `worldPublicControllerListWorldCharacters` are removed; use
  `worldPublicControllerListWorldCatalog`, `worldPublicControllerListWorldCharacterCatalog`
  and the new public `worldPublicControllerListPersonaCharacterCatalog`. Each
  returns `{ items, nextCursor, hasMore, totalCount }`, takes `cursor`, `q`
  (server-side search) and `limit` (default 20, at most 100), and rejects a
  malformed cursor or one from another query with `CATALOG_CURSOR_INVALID` /
  `CATALOG_CURSOR_SCOPE_MISMATCH`. Migration: page with `nextCursor` until it
  is `null` instead of reading one capped array, and send search terms as `q`
  instead of filtering a loaded page. The owned/public
  `worldCoreControllerListPersonaCharacters` array contract is unchanged.
- `WorldPublicItemDto.tags` is replaced by `genre` (string or null), `themes`
  (string array) and `era` (string or null), read directly from the World's
  canonical identity; `WorldPublicSourceCardDto.tags` is replaced by `traits`
  and `topics`, and interaction-mode tokens are no longer projected. Migration:
  read the explicit fields instead of splitting `tags`.
- `WorldPublicItemDto.time` is a union on `mode`: a `static` world returns
  `{ mode, label, currentWorldTime: null }` and no anchor, flow or pause fields;
  a `wallClockAnchored` world returns its anchor, flow, pause state,
  `pausedWorldTime` and computed current time. `WorldCoreValueDto.timeModel`
  follows the same split (`static` carries only `mode` and a nullable `label`).
  Migration: branch on `mode`; do not derive a date for static worlds.
- `WorldPublicController_getWorldDetailWithCharacters` returns only the first
  page (up to 20) of `sources.characters` and `sources.personaCharacters`, with
  `charactersNextCursor` / `personaCharactersNextCursor` to continue in the
  catalogs; `world.stats` carries the totals. Migration: follow the cursors
  instead of assuming the arrays are complete.

### Fixed

- World and Persona discovery distinguish offline waiting, first-page failure
  and later-page failure while keeping already loaded results available. Both
  Persona entry points can load subsequent pages, and World detail caches are
  scoped to the Realm target. The post location picker reports a failed World
  search instead of presenting it as an empty catalog.
- LocalAgent chat, summaries, life turns and Chat Track sidecar steps run on
  text targets that take no output limit, such as ChatGPT plan `gpt-6-astra`,
  instead of failing every turn with `AI_TEXT_BEHAVIOR_UNSUPPORTED`. Runtime's
  own output reservation is sent as the provider limit only where the exact
  target accepts one, so other targets receive the same limit as before. A
  caller's explicit `max_output_tokens` or `max_tokens` is still the hard limit
  and still fails before dispatch on a target that cannot honor it.
- `@nimiplatform/app-tools` scaffolds give the project `LICENSE` to the App:
  `nimi-app create` writes it once as an MIT license naming `--author`, or the
  App title when no author is given, and `nimi-app sync` never rewrites it
  while `nimi-app check` no longer hash-locks it. The template's own MIT
  notice moves to the scaffold-managed `licenses/nimi-app-template.txt`.
  Projects created while app-tools still managed `LICENSE` keep the file byte
  for byte: the next `sync` records the App as its owner, reports the
  handover (and whether the file still holds the earlier template text) and
  adds the notice, and `check` asks for that sync first. Replace a license
  that still names the template holder with the App's own terms.
- Scaffolded Electron Hosts and the Nimi Lab Host install Kit's standard
  application menu instead of clearing it, so macOS text editing shortcuts
  (Cmd+C/V/X/A/Z) and Cmd+Q work. `nimi-app sync` refreshes the managed
  `src-electron/main.ts`; Apps with their own Host keep it.
- The scaffold's connection gate uses plain copy with real recovery: Try
  again re-checks the Nimi session and Open Nimi asks a running Nimi, through
  the existing Desktop Open bridge, to show the App's page and reports the
  result in plain words. Reason codes, Runtime hints and the offline tier move
  into a collapsed Technical details area, and the gate uses the information
  tone instead of the warning tone. New scaffolds receive the updated
  App-owned `src/workbench-core/runtime-gate.tsx` and
  `src/workbench-core/workbench-core.css`; `nimi-app sync` updates the
  managed `src/shell/workbench-target-adapter.ts`, whose plain copy also
  reaches an earlier App-owned gate. That gate keeps its own layout, including
  its offline-tier line, until those two App-owned files are ported by hand.
- Component npm release workflows treat a missing registry version as
  unpublished without mistaking npm's JSON error output for a published digest.
- Nimi Lab and scaffolded AI Studio media parameter fields (music generation,
  recording transcription, voice conversion, audio separation) and their
  recovery panels refresh AIConfig readiness after an in-app AI config write,
  instead of waiting for window focus or a reload. Closing the drawer
  dispatches the app-local `nimi://ai-studio-ai-config-changed` event that
  `subscribeStudioAIConfigRefresh` handles alongside focus and visibility, and
  the run-target gate uses the same event instead of re-reading on drawer
  state. Closing does not wait for a pending write, so the AIConfig panel also
  reports a committed write through the new `onCommitted` render input, which
  dispatches the same event even after the drawer has closed; a conflicting or
  failed write notifies no consumer. The media parameter fields apply only
  their newest AIConfig read, so a late answer to an older read cannot undo
  newer readiness. `@nimiplatform/app-tools` packs this AI Studio core and the
  studio-media slice into `--features studio-media` scaffolds as App-owned
  `src/capabilities/ai-studio-core/**` and `src/capabilities/studio-media/**`,
  which `nimi-app sync` never rewrites: existing scaffolds must port
  `ai-config.ts`, `index.ts`, `section-ai-testing.tsx`,
  `section-ai-testing-run.ts`, and `section-ai-testing-surface.tsx`, plus
  `audio-separate-parameters.tsx`, `voice-convert-parameters.tsx`,
  `music-transcription-parameters.tsx`, and `music-parameters.tsx`, by hand,
  together; the packed studio-media templates import `../../ai-studio-core/`
  (the Lab layout), which scaffolds use as `../ai-studio-core/`. `nimi-app
  sync` updates the generated AIConfig panel, which uses
  `onCommitted` when the ported core supplies it and otherwise keeps
  refreshing only itself.
- Runtime startup cleanup also removes interrupted voice-conversion staging
  (`source.wav`, `target.wav`, `vocal.wav`), transcription staging
  (`events.json`, `timeline.json`), and audio-separation staging
  (`speech-staging/sep-*` with `source.wav` and its exact stem files), still
  only by Runtime-allocated numeric directory and exact file name.

## [0.2.0] - 2026-08-31

### Added

- `nimi` Runtime daemon and current CLI surface: foreground/background lifecycle,
  diagnostics, configuration, inter-App messaging, and audit operations.
- Runtime service implementations and gRPC wiring
- Runtime/user/developer docs (`docs/getting-started`, `docs/runtime`, `docs/sdk`, `docs/protocol`, `docs/dev/*`)
- Open source governance bootstrap docs (`SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `DCO`)
- npm author release set for `@nimiplatform/sdk` + `@nimiplatform/app-tools`, including package-qualified one-shot author commands via `pnpm dlx @nimiplatform/app-tools ...`

### Changed

- **Breaking (`@nimiplatform/sdk` 0.x):** Caller-local ScenarioJob abort now reports `OPERATION_ABORTED` without fabricating a Runtime `CANCELED` terminal status; applications may present it as a stopped operation while preserving the distinct reason.
- Runtime local catalog and install-plan SDK projections now treat an unspecified engine runtime mode as engine-neutral acquisition metadata while continuing to reject unknown declared modes.
- **Breaking (`@nimiplatform/sdk` 0.x):** AIProfile machine projections now use exact Machine Loadout names (`loadouts`, `loadoutId`, and `NimiAIProfileAuthoringMachineLoadoutProjection`), including the bounded Local App Model Config selection projection. Portable local implementation-configuration intent remains unchanged.
- **Breaking (`@nimiplatform/sdk` 0.x):** The public Runtime local environment plane is now exposed by `NimiRuntimeLocalEnvironmentClient` and `createNimiRuntimeLocalEnvironmentClient`; the narrower `LocalAssetAdmin` client, types, source modules, and exports were removed without aliases.
- **Breaking (`@nimiplatform/sdk` 0.x):** ScenarioJob error diagnostics now expose `NimiRuntimeScenarioJobErrorTerminalStatus` and `getNimiRuntimeScenarioJobTerminalStatusFromError`, preserving the existing FAILED/CANCELED/TIMEOUT values without treating the helper as a complete terminal-state projection.
- `README.md` source-checkout quick start aligned with `nimi init` and foreground
  `nimi serve`; connector custody and model selection remain on the Desktop
  protected Runtime surface.
- Runtime AI scenario outputs and stream deltas now use typed `ScenarioOutput` / discriminated delta wrappers instead of generic `google.protobuf.Struct`-style payload decoding.
- `realm.raw` and `runtime.raw` were renamed to `realm.unsafeRaw` and `runtime.unsafeRaw` to make raw transport boundaries explicit.
- High-level SDK AI surfaces no longer expose fallback controls; public scenario execution paths now normalize to fail-close / `DENY`.
- SDK AI provider image file inputs now require an explicit `mediaType`; image payloads fail closed instead of inferring or defaulting MIME type.
- `@nimiplatform/sdk/realm` no longer re-exports DTO types directly; migrate external `import type { SomeDto }` usage to `RealmModel<'SomeDto'>`.

### Removed

- **Breaking (Runtime/SDK 0.x):** Retired public Local ExecutionHost lifecycle RPCs and generated clients were removed; ExecutionHost supervision remains Runtime-private.
- Retired Desktop `LOCAL_AI_*` projection codes and unused Runtime voice-job/descriptor reasons were removed without compatibility aliases.
- Retired public generation, auth, grant, knowledge, model/provider, and
  workflow CLI groups; protected product configuration is not exposed through
  replacement command aliases.
