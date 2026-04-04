# Video Food Map Discovery Contract

> Rule namespace: VFM-DISC-*

## VFM-DISC-001 — Map Promotion Rule

Only coordinate-backed records may appear on the map. Auto-promoted map records require a usable store location and successful coordinate resolution. A user-confirmed record may also appear on the map, but only if usable coordinates already exist.

## VFM-DISC-002 — Creator Search Rule

Search and filter must support at least:

- creator
- area
- store
- recommended dish
- cuisine
- flavor
- review state

## VFM-DISC-003 — Evidence Preservation

Map cards and search results must preserve creator-specific evidence. The app must not flatten multiple creator recommendations into a source-less summary.

## VFM-DISC-004 — Store Confirmation Follows Extraction Order

Store confirmation must follow `VFM-PIPE-002`:

- start with video body text (`title`, `description`, `tags`) and transcription
- then allow public comments to clarify unresolved store names or addresses
- then allow targeted visual clues only when store or address remains unresolved

Comment or visual clues that conflict with stage-1 evidence must keep the record in review state.

## VFM-DISC-005 — Comment Store/Address Completion

Comment ingestion uses the platform reply API (e.g. Bilibili `/x/v2/reply/main`) to fetch public comments without login state. The scope is store name and address completion only. Comment signals that confirm or clarify an unresolved store name or address may promote a record out of review. Comment signals that contradict stage-1 evidence must keep the record in review state, not silently override.

## VFM-DISC-006 — Review Queue is Product Surface

Unresolved or conflicting records are not discarded. They enter a review queue so later signals can promote them into map truth.

## VFM-DISC-007 — Geocoding Gate

Address text or geographic candidates must be normalized into usable map coordinates before map promotion. Text-only location clues may remain searchable or reviewable, but they are not yet confirmed map locations.

## VFM-DISC-008 — User Curation Actions

The app may expose user curation actions on venue candidates, including manual confirmation and favorites.

- manual confirmation may promote a record onto the map only when usable coordinates already exist
- favorite state is a personal shortlist signal only; it must not by itself change review state or map-promotion eligibility

## VFM-DISC-009 — Nearby Discovery Uses Explicit Current Location

The discovery map may request the user's current location to show nearby mapped venues, but it must do so only after an explicit user action.

- only coordinate-backed records may be distance-ranked or nearby-filtered against the user's current location
- nearby ordering or radius filtering must be derived from the user's current coordinates plus the venue's stored coordinates; the app must not guess distance from text-only city or area labels
- if current-location access is unavailable, denied, or fails, discovery falls back to the normal filtered map surface and must keep that state visible to the user

## VFM-DISC-010 — Map Navigation Handoff

Clicking a map point must expose navigation information for that venue.

- the handoff surface must show at least the venue name plus either normalized address text or usable coordinates
- outbound navigation links or jump targets must be built from the same stored coordinates used for map display
- records without usable coordinates may stay selectable elsewhere in the product, but they must not expose a fake navigation handoff from the map
