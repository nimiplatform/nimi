# Video Food Map Menu Advisor Contract

> Rule namespace: VFM-MENU-*

## VFM-MENU-001 — Menu Advisor is Stage-3 Enhancement

Menu capture and dining advice are stage-3 enhancements. They do not gate the stage-1 creator-video extraction product.

## VFM-MENU-002 — Real Menu Boundary

Dish recommendations must be based on a real captured menu or already confirmed store recommendations. The app must not invent dishes that do not appear in the menu or the confirmed recommendation record.

## VFM-MENU-003 — Dining Context Inputs

Menu advice may consider:

- dietary restrictions
- taboo ingredients
- party size
- flavor preference

These inputs influence dish selection only after the menu/store truth is established.

## VFM-MENU-004 — Recommendation Transparency

Menu advice must explain why a dish is suggested, flagged, or excluded. Uncertain suggestions must remain visibly uncertain.

## VFM-MENU-005 — Dining Preference Profile Persistence

The app must persist a structured dining preference profile in app-owned local settings for later menu-advice use.

- the profile must support at least dietary restrictions, taboo ingredients, flavor preferences, and cuisine preferences
- collecting or editing this profile may ship before real menu capture and dish recommendation
- saved preferences are personal configuration only; they must not rewrite extracted venue truth, review state, or map-promotion eligibility
