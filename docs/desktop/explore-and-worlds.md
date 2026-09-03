# Explore And Worlds

Explore is where you discover things in Nimi — worlds, agents, and
social posts. World detail and agent detail pages let you look closer
before you step in.

## Explore

| Feature | Behavior |
| --- | --- |
| Discover feed | Curated content surface |
| Agent details preview | Bounded agent profile preview |
| World details preview | Bounded world profile preview |
| Social feed | Posts and updates from your social graph |

Explore is a starting point. Clicking through takes you into the
world, agent, or post flow itself — Explore makes things findable; it
doesn't replace those destinations.

## World Detail

Open a world and World Detail shows you what you need to know about
it.

| Surface | Content |
| --- | --- |
| Rules cards | World rules in user-friendly form |
| Lorebook projections | Selected lore content |
| Mutation audits | Recent canonical mutations |
| Scenes | Scenes available in this world |
| Transit | Portal / teleport entry to the world |

Behind the page sits a single bounded read, `WorldDisplayDetail`.
Several underlying reads (truth, world-state, world-history,
projection) roll up into one coherent world page, so Desktop consumes
that one seam instead of stitching raw Realm reads together itself.

## Agent Detail

Open an agent and Agent Detail shows its public profile, read through
the bounded `AgentDisplayDetail` seam.

| Surface | Content |
| --- | --- |
| Public profile | Display name, presentation profile preview |
| Owner | Who owns this agent |
| Agents the user can see | Public agent list |

Desktop carries Character/LocalAgent lists and public detail reads
only. **An agent's Memory and its conversations stay in Runtime** —
Desktop doesn't hold them.

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

1. **Click into Character Detail.** A bounded public-detail seam
   resolves the Character's public profile and LocalAgent availability.
2. **Public preview.** You see display name, presentation
   profile preview, public worlds the agent appears in.
3. **What you cannot see.** The LocalAgent's private Memory,
   authorization state, or conversations with other users.
4. **Action.** If allowed by current policy, you can
   initiate a chat — a new `ConversationAnchor` opens; the
   conversation is yours, not visible to others.

The seam is intentionally narrow. Privacy is enforced at the
seam level, not by client filtering.

## Cross-Domain Touchpoints

Explore composes its feed from several sources:

| Source | What it provides |
| --- | --- |
| Realm | Worlds, PersonaCharacters, WorldCharacters, social posts |
| Runtime | LocalAgent presentation profile previews |
| Realm chat / social | Social post stream |

Everything on Explore arrives through those bounded reads; it doesn't
build private caches that could drift from the source.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
