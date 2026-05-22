# Realm Agent Studio Spec AGENTS

## Authoritative Structure

- `index.md` is the admitted entry for the current flat authority set.
- `product-scope.md`, `realm-agent-object.md`, `agent-setting-field-map.md`,
  `asset-and-binding.md`, `post-publishing.md`,
  `runtime-ai-consumption.md`, `metrics-and-realm-gaps.md`,
  `failure-semantics.md`, `storybook.md`, and
  `product-acceptance-and-execution-plan.md` are the active authority documents
  for this stage.

## Editing Rules

1. `apps/realm-agent-studio/spec/**` is the only active Realm Agent Studio app
   authority root in this repo. Do not create `.nimi/spec/realm-agent-studio/**`
   or any other parallel root.
2. This stage is admission-first. Keep the flat document set authoritative
   until a later admitted change explicitly introduces `kernel/` or `tables/`.
3. Topic files under `.nimi/topics/**` are evidence inputs only after their
   contents are absorbed here; they are not parallel authority.
4. Studio canonical my-agents surfaces are `/api/me/agents` and
   `/api/me/agents/{agentId}`.
5. `/api/creator/agents` and `/api/agent/dev/my-agents` are evidence-only and
   must not be promoted into Studio canonical surfaces.
6. The first-version owner-visible metric field is top-level `friendCount`.
   Do not invent `agentFriendCount`.
7. Do not expand scope into Realm lifecycle ownership, Realm scheduling,
   LocalAgent private state, or world-created agent management.
8. Do not claim product acceptance from renderer tests, partial feature wiring,
   or browser screenshots. Final acceptance is governed by
   `product-acceptance-and-execution-plan.md`.
