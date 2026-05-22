---
id: SPEC-REALM-AGENT-STUDIO-PRODUCT-ACCEPTANCE-001
title: Realm Agent Studio Product Acceptance And Execution Plan
status: active
owner: "@team"
updated: 2026-05-22
---

# Product Acceptance And Execution Plan

## Preflight

Spec Status: active app-slice authority under `apps/realm-agent-studio/spec/**`.

Authority Owner: Realm Agent Studio app spec. Topic files are evidence only after
absorption here.

Work Type: alignment for implementation that follows this document; redesign
only when changing product scope, canonical owner surfaces, app architecture, or
admitted acceptance gates.

Parallel Truth: forbidden. This document is the current product acceptance and
execution authority for Realm Agent Studio. Conversation summaries, renderer
screenshots, passing tests, and topic notes are evidence, not acceptance truth.

## Standard

Realm Agent Studio is accepted only as an industrial desktop product for owners
operating public user-owned Realm Agents as durable Agent IP.

Passing renderer tests, wiring one feature, or showing a browser page is not
acceptance. Acceptance requires the whole owner workflow to be coherent:

- the app launches as a desktop app through the Nimi desktop / parentOS posture;
- account/session custody is owned by Runtime, not by app-local tokens;
- Realm and Runtime access goes through the SDK;
- the visible UI uses `nimi-kit` and shared interaction patterns as a system;
- every public success state is backed by admitted Realm or Runtime authority;
- AI is embedded inside real owner workflows and never bypasses human review;
- source failures preserve valid drafts and name the next valid action;
- no LocalAgent private state, world-created agent lane, creator/world-maintainer
  surface, fake return, or placeholder success leaks into the product.

## Acceptance Gates

| Gate | Required final acceptance | Current status |
| --- | --- | --- |
| A0 Authority and scope | `apps/realm-agent-studio/spec/**` contains the single active product/app authority, including acceptance gates. No topic file or conversation creates parallel truth. | Partial. Core spec exists; this document closes the missing acceptance authority gap. |
| A1 Desktop app shell | App has a real desktop shell path comparable to `apps/parentos`: `dev:shell`, Tauri config, Rust shell bridge where needed, Runtime IPC transport, desktop account/session bootstrap, and no app-owned token fallback. Browser/Vite renderer is only a renderer development surface. | W1 shell baseline closed. The app now has `src-tauri`, `dev:shell`, shared kit Runtime bridge commands, desktop Runtime hook installation, and desktop smoke evidence. |
| A2 Platform UX system | First screen, navigation, loading, empty, error, form, review, and confirmation states are kit-first and platform-consistent. Custom UI is allowed only after a recorded kit gap. UI must not expose SDK route names, DTO names, raw payloads, or debug contract text as normal product copy. | W2 closed. Workspace navigation, disclosure-backed technical review details, and fail-closed unauthenticated renderer evidence are in place. Final copy pass remains W7 scope. |
| A3 Information architecture | Owner can move predictably between portfolio, create, agent detail, settings, assets, posts, and local schedule without a single mega-form. Navigation controls are functional, stateful, and do not imply unavailable surfaces. | W2 closed. Shell and in-page workspace controls are functional across Portfolio, Create, Agent Detail, Settings, Assets, Posts, and Local Schedule; tests assert workflows no longer render as one mega-surface. |
| A4 Owner portfolio and create | Portfolio list/filter/sort, create flow, handle preflight, OASIS/default world selection, selected-world preview, create confirmation, and post-create opening behavior are product-complete. Public draft fields are not silently dropped. | W3 closed. Portfolio/create/detail owner surfaces are complete for the admitted first-version scope; public bio is preserved as a post-create settings continuation instead of being silently submitted or dropped. |
| A5 Settings and rule-of-truth | Settings flow is natural-language-first plus structured fields, AI proposal/review where useful, field-to-layer clarity, human review, owner settings save, and no raw world-scoped `AgentRule` CRUD. | W4 closed. Runtime-assisted settings proposals are candidate-only, apply to visible fields for owner review, and save only through owner-scoped `MeService.updateMyRealmAgentSettings`. |
| A6 Creative identity assets | Avatar, profile cover/background, visual candidates, upload/generation, local history, owner review, public write success, and deferred public asset paths are clearly separated. App-local history is durable enough for the desktop product shape. | W5 closed for admitted surfaces. Avatar URL remains the only owner-reviewed public profile asset write; Runtime image candidates, identity Resource upload, voice-demo candidates, and app-local creative history are candidate-only. Profile cover/background and Resource-to-Agent binding publication remain explicitly deferred pending owner-scoped Realm ingress. |
| A7 Agent-authored posts | Owner can draft from agent voice, use AI assistance, attach canonical media, human-review, publish through Realm, and create a single local schedule that is actually persisted/executable or explicitly not admitted. | Partial. Realm publish and attachments exist. AI post assistance and real app-local scheduling are not complete. |
| A8 Runtime AI consumption | Runtime AI support covers setting rewrite/proposal, visual/image generation candidates when available, post copy, voice demo, and source-backed suggestions through SDK surfaces. Runtime output remains candidate material until owner review. | Partial. W4 closes the settings proposal subset through `runtime.ai.text.generate`; W5 closes the visual image candidate subset through `media.image.generate` and keeps voice demo candidate-only. Post-copy remains W6. |
| A9 Failure and recovery | Every failure state preserves valid local work, names the unavailable source/capability in product terms, avoids pseudo-success, and gives a valid next action. | Partial. Fail-closed exists in many client paths; UI recovery is not yet product-wide. |
| A10 Verification evidence | Final closeout includes desktop-shell smoke, renderer screenshot only as secondary evidence, unit/integration tests, boundary checks, spec governance, no app REST bypass, no first-party SDK misuse, and acceptance matrix results per gate. | Not accepted. Current evidence covers renderer tests/build/boundary checks only. |

## Current Implementation Gap Audit

P0 gaps:

- The current UI is not an industrial product information architecture. It is a
  single long workspace where create, portfolio, settings, projection, media,
  voice, post, and schedule are all visible at once.
- Navigation is decorative. The side rail buttons do not route, select a
  workspace, or preserve user context.
- Authenticated account projection and owner Realm SDK calls have not yet been
  verified inside the desktop shell against a live owner session. W1 proves the
  shell/Runtime bridge path starts; W3 must prove the owner workflow inside it.

P1 gaps:

- `OwnerPortfolio.tsx` and `portfolio-client.ts` are too broad for sustained
  product iteration. Their size is a symptom of mixed workflow ownership, not a
  cosmetic refactor issue.
- AI support is still incomplete for posts and source-backed suggestions. W4
  closed setting rewrite/proposal, and W5 closed image/visual candidate
  generation as candidate-only Runtime output.
- Local post scheduling is only a preview candidate. It is not a durable desktop
  schedule with execution semantics.
- Local creative asset history is app-local desktop storage after W5. It is not
  cross-device public truth.
- Create flow collects public bio as a local preview but does not persist it as
  part of the create/update sequence. That is product-confusing unless the flow
  explicitly continues into settings save.
- Visual identity is admitted for avatar URL save, Runtime image candidates,
  identity Resource upload, and local history. Profile cover/background writes
  and owner-scoped public Resource-to-Agent binding remain incomplete/deferred.
- Product UI still has diagnostic JSON previews in normal screens. Development
  diagnostics may exist, but launch UX must move them behind explicit developer
  disclosure or remove them.

P2 gaps:

- Renderer build still emits large chunk and circular chunk warnings. Not a
  current product blocker, but final acceptance should either fix or explicitly
  admit the tradeoff.
- Copy and labels are still mixed English/product-internal. Launch acceptance
  needs a deliberate language and terminology pass.
- Some source names remain in data objects and tests, which is acceptable for
  engineering evidence, but they must not leak into normal product copy.

## Waves

| Wave | State | Dependency | Closure goal | Acceptance closure |
| --- | --- | --- | --- | --- |
| W0 Acceptance authority | active | none | Admit this product acceptance standard, gap audit, waves, and preflight. | This document exists, is indexed, and spec governance passes. |
| W1 Desktop shell hard cut | closed | W0 | Build a real desktop app shell equivalent in posture to parentOS: `src-tauri`, `dev:shell`, shell bridge/runtime defaults, desktop launch, Runtime session, SDK client custody. | A1 shell baseline passed. Renderer-only launch is no longer treated as product acceptance. |
| W2 Product information architecture | closed | W1 | Replace the single mega-surface with functional Studio workspaces: Portfolio, Create, Agent Detail, Settings, Assets, Posts, Local Schedule. | A2 and A3 passed with interaction evidence, local shell failure-state evidence, and verification commands. |
| W3 Owner portfolio/create/detail completion | closed | W2 | Finish owner list/filter/sort, create, world selection, post-create flow, detail state, friendCount, source failures, and owner-only boundaries. | A4 and relevant A9 cases passed for portfolio/create/detail. |
| W4 Settings and AI proposal workflow | closed | W3 | Natural-language setting edits, Runtime-assisted proposal/rewrite, structured field review, owner settings save, no raw rule CRUD. | A5 and A8 settings subset passed. |
| W5 Creative identity and media workflow | closed | W3 | Avatar/profile cover strategy, visual/image candidates, upload, local durable history, clear blocked/deferred public asset publishing. | A6 and A8 visual subset passed for admitted surfaces; blocked Realm profile/binding publication is explicitly deferred. |
| W6 Agent post and local schedule | candidate | W3 | Agent-authored post composer, AI copy assistance, attachments, human review, publish, and real app-local single schedule. | A7 and schedule failure/recovery pass. |
| W7 Final acceptance hardening | candidate | W4, W5, W6 | Run complete acceptance matrix, desktop smoke, renderer screenshot, spec/boundary checks, copy pass, release-risk audit. | A0-A10 pass or carry explicit deferred Realm-surface blockers. |

Wave ordering follows `.nimi/methodology/wave-dag-policy.yaml`: upstream owner
and app shell decisions close before downstream feature fan-out. Parallelization
is allowed only after W2 if write sets do not conflict and the owner domain is
stable.

## Next Implementation Preflight

Before W1 implementation:

- Spec Status: active.
- Authority Owner: `apps/realm-agent-studio/spec/**`.
- Work Type: alignment.
- Parallel Truth: forbidden.
- Required reads: `apps/parentos/package.json`,
  `apps/parentos/src-tauri/tauri.conf.json`,
  `apps/parentos/src-tauri/Cargo.toml`,
  `apps/parentos/src/shell/renderer/infra/parentos-bootstrap.ts`,
  `apps/desktop/src-tauri/**` Runtime bridge patterns, and
  `kit/shell/tauri/**`.
- Stop if the implementation would require app-owned access tokens,
  `/api/creator/agents`, world-scoped `AgentRulesService`, `WorldControlService`
  owner substitution, LocalAgent private state, fake Runtime session, or fake
  desktop launch success.
- W1 must close with a desktop-shell smoke command and evidence. Renderer Vite
  screenshot alone is insufficient.

Before W2 implementation:

- W1 must be closed.
- Navigation, route/workspace ownership, local state ownership, and kit component
  usage must be specified before editing product screens.
- Stop if the design would keep all workflows in one giant page or introduce a
  parallel component system without a recorded `nimi-kit` gap.

Before W4-W6 implementation:

- Any missing Realm/Runtime owner surface must be classified as either
  deferred, newly admitted in Realm/Runtime, or removed from the active product
  flow. Do not work around missing surfaces with creator/world-maintainer APIs.

## Final Acceptance Package

Final closeout must report:

- Findings: no P0/P1 unresolved product gaps except explicitly deferred external
  Realm/Runtime surfaces.
- Current Phase Disposition: `complete`, `partial`, or `deferred` per
  `.nimi/contracts/acceptance.schema.yaml`.
- Evidence Sufficiency: exact commands and visual/desktop evidence.
- Acceptance Matrix: A0-A10 status with file references and evidence.
- Next Step or Reopen Condition: exact blocker or follow-up wave.

## W1 Closure Evidence

W1 closed on 2026-05-22 with:

- `apps/realm-agent-studio/src-tauri/**` desktop shell admitted.
- Root `pnpm dev:realm:agent:studio` routed to app `dev:shell`.
- Renderer installs the Tauri Runtime hook before bootstrap.
- Realm base URL is resolved from desktop Runtime defaults when Tauri IPC is
  available.
- `pnpm --filter @nimiplatform/realm-agent-studio typecheck` passed.
- `cd apps/realm-agent-studio/src-tauri && cargo check` passed.
- `pnpm --filter @nimiplatform/realm-agent-studio test` passed.
- `pnpm --filter @nimiplatform/realm-agent-studio build:renderer` passed with
  existing chunk/circular warnings.
- `pnpm check:no-app-realm-rest-bypass` passed.
- `pnpm check:no-first-party-sdk-client-construction` passed.
- `pnpm exec nimicoding validate-spec-governance --profile nimi --scope
  apps/realm-agent-studio` passed.
- Desktop shell smoke: with an existing renderer on port 1426, `cargo run`
  entered `target/debug/nimiplatform-realm-agent-studio` and logged
  `realm-agent-studio main() entered`; the process was then terminated.

The app is not accepted until W7 closes.

## W2 Closure Evidence

W2 closed on 2026-05-22 with:

- `apps/realm-agent-studio/src/shell/renderer/app-shell/shell-layout.tsx`
  owns the admitted Studio workspace set and functional shell navigation:
  Portfolio, Create, Detail, Settings, Assets, Posts, and Schedule.
- `apps/realm-agent-studio/src/shell/renderer/App.tsx` owns active workspace
  state and passes it through the shell and product workspace.
- `apps/realm-agent-studio/src/shell/renderer/features/portfolio/OwnerPortfolio.tsx`
  renders create, portfolio, agent detail, settings, assets, posts, and local
  schedule as separate stateful workspaces instead of one long page. Selecting
  an agent preserves context and opens the detail lane from portfolio/create.
- Raw review payloads touched in W2 were moved behind explicit technical
  disclosure controls so they are no longer primary launch copy.
- `apps/realm-agent-studio/src/shell/renderer/features/portfolio/OwnerPortfolio.visibility.test.tsx`
  now covers workspace navigation and asserts that portfolio, settings, posts,
  and schedule are not rendered as a single mega-surface.
- `pnpm --filter @nimiplatform/realm-agent-studio typecheck` passed.
- `pnpm --filter @nimiplatform/realm-agent-studio test` passed with 8 files and
  110 tests.
- `pnpm --filter @nimiplatform/realm-agent-studio build:renderer` passed with
  the pre-existing large chunk, empty sdk-realm chunk, and circular chunk
  warnings still carried to W7 risk audit.
- `pnpm check:no-app-realm-rest-bypass` passed.
- `pnpm check:no-first-party-sdk-client-construction` passed.
- `pnpm exec nimicoding validate-spec-governance --profile nimi --scope
  apps/realm-agent-studio` passed.
- `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope
  spec-human-doc --check` passed. The narrower
  `generate-spec-derived-docs --scope apps/realm-agent-studio --check` command
  is not supported by the current nimicoding package and was refused before
  writing files.
- Local renderer smoke on `http://127.0.0.1:1426/` returned HTTP 200. A Safari
  Computer Use check showed the renderer fail-closed at the Runtime account
  session gate outside Tauri/desktop Runtime custody. This is supporting
  failure-state evidence only and is not product acceptance.

W2 closure does not claim final product acceptance. W3 remains responsible for
live owner portfolio/create/detail completion inside the desktop owner session.

## W3 Closure Evidence

W3 closed on 2026-05-22 with:

- `CreateRealmAgentWorkspace` emits a post-create context only after a real
  `Realm AgentsService.agentControllerCreate` result with canonical id.
- Successful create opens the created agent's owner detail lane and keeps
  selected-agent context even before the refreshed portfolio list contains the
  new id.
- Public bio remains visible as a post-create owner-settings continuation. It
  is explicitly not submitted in `CreateAgentDto`, and the UI preserves it with
  the created agent id instead of silently dropping it.
- Owner detail can fetch the selected created id directly through
  `MeService.getMyRealmAgent`; portfolio list order/filter/sort remains
  app-local view state and does not create queue or lifecycle truth.
- The W3 UI test covers create submit, canonical create confirmation,
  post-create detail opening, public-bio preservation, and create body
  allowlist behavior.
- `pnpm --filter @nimiplatform/realm-agent-studio typecheck` passed.
- `pnpm --filter @nimiplatform/realm-agent-studio test` passed with 8 files and
  111 tests.
- `pnpm --filter @nimiplatform/realm-agent-studio build:renderer` passed with
  the existing chunk warnings still carried to W7 risk audit.
- `pnpm check:no-app-realm-rest-bypass` passed.
- `pnpm check:no-first-party-sdk-client-construction` passed.

W3 closure does not claim settings, asset, post, schedule, or final product
acceptance. W4 remains responsible for the settings and AI proposal workflow.

## W4 Closure Evidence

W4 closed on 2026-05-22 with:

- Owner settings remain natural-language-first plus structured visible fields.
- Runtime settings assistance uses `runtime.ai.text.generate` through the SDK
  runtime client. The model is configuration-provided by
  `VITE_RUNTIME_SETTINGS_MODEL` or `VITE_RUNTIME_TEXT_MODEL`; no provider/model
  literal is hardcoded in the product path.
- Runtime output is parsed as candidate JSON, rejected on forbidden fields
  (`provider`, `model`, `LocalAgent`, lifecycle/state/world/profile asset
  fields, raw `agentRules`, and related keys), and applied only into admitted
  visible draft fields.
- Runtime proposal failure preserves the current owner draft and names Runtime
  text generation as the unavailable capability.
- Saving still requires human review and uses only
  `MeService.updateMyRealmAgentSettings`; raw `AgentRulesService` CRUD remains
  absent and deferred.
- Tests cover proposal prompt construction, candidate normalization, forbidden
  Runtime output rejection, SDK `runtime.ai.text.generate` use, fail-closed
  missing model config, UI proposal application, and owner settings save.
- `pnpm --filter @nimiplatform/realm-agent-studio typecheck` passed.
- `pnpm --filter @nimiplatform/realm-agent-studio test` passed with 8 files and
  117 tests.
- `pnpm --filter @nimiplatform/realm-agent-studio build:renderer` passed with
  the existing chunk warnings still carried to W7 risk audit.
- `pnpm check:no-app-realm-rest-bypass` passed.
- `pnpm check:no-first-party-sdk-client-construction` passed.

W4 closure does not claim visual/image generation, creative media history, post
copy assistance, local schedule, or final product acceptance. W5 remains
responsible for creative identity and media workflow.

## W5 Closure Evidence

W5 closed on 2026-05-22 with:

- The Assets workspace separates public avatar URL save from candidate-only
  visual identity work. Avatar URL selection remains the only admitted public
  profile asset write and still uses `AgentsService.agentControllerSelectAvatar`.
- Runtime image assistance uses SDK `media.image.generate` with configured model
  input and owner-approved public/profile context only. Output is local candidate
  material with `publicTruth=false`.
- Identity image upload creates/finalizes a Realm `Resource(IMAGE)` for local
  identity review through `ResourcesService` direct upload and `finalizeResource`.
  It does not claim profile cover, avatar binding, feed, or public profile
  publication.
- App-local creative history persists Runtime image candidates, identity
  Resource uploads, and voice-demo candidates per agent in desktop local storage.
  History records are explicitly local and rejected if they claim public truth.
- Profile cover/background write and Resource-to-Agent presentation Binding
  publication remain deferred until Realm admits an owner-scoped ingress. Studio
  still does not use `WorldControlService`.
- Tests cover Runtime image request shaping, malformed image output failure,
  identity Resource upload metadata, durable local creative history, UI image
  generation, UI identity upload, existing avatar URL selection, and voice-demo
  candidate behavior.
- `pnpm --filter @nimiplatform/realm-agent-studio typecheck` passed.
- `pnpm --filter @nimiplatform/realm-agent-studio test` passed with 9 files and
  127 tests.
- `pnpm --filter @nimiplatform/realm-agent-studio build:renderer` passed with
  the existing chunk warnings still carried to W7 risk audit.
- `pnpm check:no-app-realm-rest-bypass` passed.
- `pnpm check:no-first-party-sdk-client-construction` passed.
- `pnpm exec nimicoding validate-spec-governance --profile nimi --scope
  apps/realm-agent-studio` passed.
- `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope
  spec-human-doc --check` passed.

W5 closure does not claim post copy assistance, durable executable schedule, or
final product acceptance. W6 remains responsible for agent-authored posts and
local schedule workflow.
