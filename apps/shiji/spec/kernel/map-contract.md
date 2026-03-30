# ShiJi Map Contract

> Rule namespace: SJ-MAP-*
> Scope: Historical atlas view, spatial exploration, time-map linkage

## SJ-MAP-001 — Map Is Secondary Explore Surface

The map view is a secondary Explore surface:

1. Timeline remains the primary navigation metaphor for ShiJi
2. Map view augments historical understanding with place, movement, and event context
3. Map view must not replace timeline ordering, chapter flow, or catalog gating
4. The atlas route exists only for worlds and views explicitly enabled by `map-surface.yaml`

## SJ-MAP-002 — Catalog and Profile Gating

Map availability is governed by both catalog metadata and map profiles:

1. Only worlds present in `world-catalog.yaml` may be considered for map display
2. A world is atlas-eligible only when `mapAvailability = true` in `world-catalog.yaml`
3. Atlas-eligible worlds must also have a matching enabled profile in `map-surface.yaml`
4. If either catalog gating or map profile is missing, the map path must fail-close

## SJ-MAP-003 — Map Content Surface

The atlas view presents typed spatial learning artifacts:

1. **Location pins** — capitals, battlefields, travel stops, institutions, landmarks
2. **Route segments** — journeys, campaigns, diplomatic routes, migrations
3. **Event anchors** — map-linked historical or story events tied to time-river nodes
4. **Viewport defaults** — a world-specific initial camera tuned to the period and geography

## SJ-MAP-004 — Time-Map Linkage

Timeline and map must reinforce each other:

1. Selecting a world on the timeline may focus the atlas on that world's viewport
2. Selecting a location or event on the atlas may highlight the corresponding time-river node
3. Event anchors must retain stable references back to world events or story landmarks
4. Spatial context must never erase or reorder the primary chronological sequence

## SJ-MAP-005 — Fail-Close Behavior

Map rendering must fail-close on missing or invalid structured inputs:

1. No placeholder geography, guessed pins, or fabricated routes after a typed path fails
2. Missing profile fields, broken event references, or disabled profiles block stable map rendering
3. The UI may explain that map data is unavailable, but it must not synthesize pseudo-success
