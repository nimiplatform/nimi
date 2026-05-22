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
| A1 Desktop app shell | App has a real desktop shell path comparable to `apps/parentos`: `dev:shell`, Tauri config, Rust shell bridge where needed, Runtime IPC transport, desktop account/session bootstrap, and no app-owned token fallback. Browser/Vite renderer is only a renderer development surface. | Not accepted. Current app has renderer-only Vite scripts and no `src-tauri` shell. |
| A2 Platform UX system | First screen, navigation, loading, empty, error, form, review, and confirmation states are kit-first and platform-consistent. Custom UI is allowed only after a recorded kit gap. UI must not expose SDK route names, DTO names, raw payloads, or debug contract text as normal product copy. | Partial. Shell and some copy were improved, but the app remains a monolithic control surface with debug previews. |
| A3 Information architecture | Owner can move predictably between portfolio, create, agent detail, settings, assets, posts, and local schedule without a single mega-form. Navigation controls are functional, stateful, and do not imply unavailable surfaces. | Not accepted. Current nav buttons are visual only and all workflows live in one long page. |
| A4 Owner portfolio and create | Portfolio list/filter/sort, create flow, handle preflight, OASIS/default world selection, selected-world preview, create confirmation, and post-create opening behavior are product-complete. Public draft fields are not silently dropped. | Partial. Owner surfaces are wired, but create UX still mixes local-only bio with create submission and does not complete a polished post-create flow. |
| A5 Settings and rule-of-truth | Settings flow is natural-language-first plus structured fields, AI proposal/review where useful, field-to-layer clarity, human review, owner settings save, and no raw world-scoped `AgentRule` CRUD. | Partial. Owner settings save exists. AI proposal/internalization and product-grade review flow are not complete. |
| A6 Creative identity assets | Avatar, profile cover/background, visual candidates, upload/generation, local history, owner review, public write success, and deferred public asset paths are clearly separated. App-local history is durable enough for the desktop product shape. | Not accepted. Avatar URL and post media upload exist; image generation, profile cover write, durable local history, and owner-scoped public asset write remain incomplete/deferred. |
| A7 Agent-authored posts | Owner can draft from agent voice, use AI assistance, attach canonical media, human-review, publish through Realm, and create a single local schedule that is actually persisted/executable or explicitly not admitted. | Partial. Realm publish and attachments exist. AI post assistance and real app-local scheduling are not complete. |
| A8 Runtime AI consumption | Runtime AI support covers setting rewrite/proposal, visual/image generation candidates when available, post copy, voice demo, and source-backed suggestions through SDK surfaces. Runtime output remains candidate material until owner review. | Not accepted. Voice demo and world projection exist; the broader AI consumption map is mostly unimplemented. |
| A9 Failure and recovery | Every failure state preserves valid local work, names the unavailable source/capability in product terms, avoids pseudo-success, and gives a valid next action. | Partial. Fail-closed exists in many client paths; UI recovery is not yet product-wide. |
| A10 Verification evidence | Final closeout includes desktop-shell smoke, renderer screenshot only as secondary evidence, unit/integration tests, boundary checks, spec governance, no app REST bypass, no first-party SDK misuse, and acceptance matrix results per gate. | Not accepted. Current evidence covers renderer tests/build/boundary checks only. |

## Current Implementation Gap Audit

P0 gaps:

- No real desktop app shell exists under `apps/realm-agent-studio/src-tauri`.
  `pnpm dev:realm:agent:studio` starts only the renderer. This is incompatible
  with final desktop-app acceptance.
- The current UI is not an industrial product information architecture. It is a
  single long workspace where create, portfolio, settings, projection, media,
  voice, post, and schedule are all visible at once.
- Navigation is decorative. The side rail buttons do not route, select a
  workspace, or preserve user context.
- Runtime account/session is gated in renderer, but there is no desktop launch
  verification that Runtime IPC, account projection, and Realm SDK calls work
  inside the actual app shell.
- Final product acceptance criteria did not exist before this document; previous
  "green" validation was too narrow.

P1 gaps:

- `OwnerPortfolio.tsx` and `portfolio-client.ts` are too broad for sustained
  product iteration. Their size is a symptom of mixed workflow ownership, not a
  cosmetic refactor issue.
- AI support is underbuilt relative to product authority: no integrated setting
  rewrite/proposal flow, no post copy assistance, no image/visual candidate
  generation workflow, and no source-backed portfolio suggestions.
- Local post scheduling is only a preview candidate. It is not a durable desktop
  schedule with execution semantics.
- Local creative asset history is component state only. It does not satisfy the
  desktop product expectation of local saved history/preview.
- Create flow collects public bio as a local preview but does not persist it as
  part of the create/update sequence. That is product-confusing unless the flow
  explicitly continues into settings save.
- Visual identity is only partially real: avatar URL can save, post media can
  upload, but profile cover/background and owner-scoped public asset binding are
  incomplete or deferred.
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
| W1 Desktop shell hard cut | candidate | W0 | Build a real desktop app shell equivalent in posture to parentOS: `src-tauri`, `dev:shell`, shell bridge/runtime defaults, desktop launch, Runtime session, SDK client custody. | A1 and desktop-shell smoke pass. Renderer-only launch is no longer treated as product acceptance. |
| W2 Product information architecture | candidate | W1 | Replace the single mega-surface with functional Studio workspaces: Portfolio, Create, Agent Detail, Settings, Assets, Posts, Local Schedule. | A2 and A3 pass with screenshot/interaction evidence. |
| W3 Owner portfolio/create/detail completion | candidate | W2 | Finish owner list/filter/sort, create, world selection, post-create flow, detail state, friendCount, source failures, and owner-only boundaries. | A4 and relevant A9 cases pass. |
| W4 Settings and AI proposal workflow | candidate | W3 | Natural-language setting edits, Runtime-assisted proposal/rewrite, structured field review, owner settings save, no raw rule CRUD. | A5 and A8 settings subset pass. |
| W5 Creative identity and media workflow | candidate | W3 | Avatar/profile cover strategy, visual/image candidates, upload, local durable history, clear blocked/deferred public asset publishing. | A6 and A8 visual subset pass or explicitly defer blocked Realm surfaces. |
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

The app is not accepted until W7 closes.
