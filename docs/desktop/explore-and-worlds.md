# Explore And Worlds

Desktop's explore surface is the entry point to discover content —
worlds, agents, social posts. World detail and agent detail
surfaces let users dive deeper. Each is a projection of canonical
Realm truth.

## Explore

| Feature | Behavior |
| --- | --- |
| Discover feed | Curated content surface |
| Agent details preview | Bounded agent profile preview |
| World details preview | Bounded world profile preview |
| Social feed | Posts and updates from your social graph |

Explore is a navigation entry point. Clicking through delegates
to other domain data flows — world flow, agent flow, post / feed
flow. Explore does not own those flows; it is the discoverable
surface.

## World Detail

When a user navigates into a specific world, World Detail is the
projection that shows them what they need to know.

| Surface | Content |
| --- | --- |
| Rules cards | World rules in user-friendly form |
| Lorebook projections | Selected lore content |
| Mutation audits | Recent canonical mutations |
| Scenes | Scenes available in this world |
| Transit | Portal / teleport entry to the world |

World Detail consumes a bounded `WorldDisplayDetail` seam.
Multiple raw reads (truth, world-state, world-history, projection)
roll up into one display authority. The reader sees a coherent
world page; Desktop consumes the seam, not the raw realm
contracts directly.

## Agent Detail

When a user navigates into a specific agent, Agent Detail shows
the agent's public profile via a bounded `AgentDisplayDetail`
seam.

| Surface | Content |
| --- | --- |
| Public profile | Display name, presentation profile preview |
| Owner | Who owns this agent |
| Agents the user can see | Public agent list |

Desktop core only carries agent list + public detail reads. **It
does not carry agent LLM memory or chat route** — those live in
the runtime / cognition path.

## Reader Scenario: Discovering And Entering A World

You browse Explore and find a world that catches your interest.

1. **Explore feed.** Desktop renders curated content. You click a
   world preview.
2. **World Detail.** A bounded `WorldDisplayDetail` seam reads
   truth, state, recent history, scenes — projects them as a
   coherent world page.
3. **Decide to enter.** You initiate transit. Per the platform's
   transit primitive, transit goes through OASIS: current world →
   OASIS → target world.
4. **Realm transit.** Realm `R-TRANSIT-*` admits the transit;
   identity stays canonical; social standing crosses
   appropriately.
5. **In the new world.** Desktop now renders the new world's
   surfaces; chat, agents, and presentation update for the new
   context.

You moved from "browsing on Explore" to "inside a world" through
admitted contracts at every step.

## Reader Scenario: Looking At An Agent

You see a public agent in Explore and want to learn more.

1. **Click into Agent Detail.** A bounded `AgentDisplayDetail`
   seam resolves the agent's public profile.
2. **Public preview.** You see display name, presentation
   profile preview, public worlds the agent appears in.
3. **What you cannot see.** The agent's `AGENT_CORE` private
   memory; the agent's internal worldview kernel; the agent's
   chat history with other users.
4. **Action.** If admitted by the agent's policy, you can
   initiate a chat — a new `ConversationAnchor` opens; the
   conversation is yours, not visible to others.

The seam is intentionally narrow. Privacy is enforced at the
seam level, not by client filtering.

## Cross-Domain Touchpoints

Explore reads from many places to compose its feed:

| Source | What it provides |
| --- | --- |
| Realm | Worlds, PersonaCharacters, WorldCharacters, social posts |
| Runtime | LocalAgent presentation profile previews |
| Realm chat / social | Social post stream |

The composition is bounded by admitted seams; Explore does not
invent its own caches that diverge from upstream truth.

## Source Basis

- [`.nimi/spec/desktop/explore.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/explore.md)
- [`.nimi/spec/desktop/world-detail.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/world-detail.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
