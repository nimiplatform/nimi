# AGENTS.md

## Scope

Applies to `runtime/catalog/source/**`.

## Purpose

This directory is the authoring work surface for
`runtime/catalog/source/providers/*.source.yaml`.

When asked to audit, refresh, or update provider catalog source, operate here
first.

## Default Workflow

1. Determine whether the request is `report-only` or `report + patch`.
2. Produce or update a provider update report before mutating source.
3. Scope the work as either:
   - `provider_wide`
   - `family_scoped`
4. Compare current source against official current inventory.
5. Prefer additive catch-up before removals.
6. Review `selection_profiles` and defaults separately from model-row updates.
7. Run relevant validation after source edits.

## Authority Rules

- `runtime/catalog/source/providers/*.source.yaml` is the authority home.
- Browser output, aggregate listings, and live probe output are support inputs
  only.
- Do not auto-promote scraped or browsed content into source truth without a
  reviewed edit.
- Prefer official provider docs over aggregate sources.

## Curation Rules

- Interpret `latest 1-2 generations` per family, not only provider-wide.
- Keep stable rows and dated snapshot rows distinct.
- Treat realtime lines as separate from non-realtime lines.
- Label preview, legacy, deployment-scoped, and user-scoped rows explicitly.
- Do not flatten multi-family providers into a single text-only review model.
- For `runtime.inventory_mode=dynamic_endpoint` providers, do not mirror live
  remote model inventories into static `models` rows.

## Inventory Modes

- `static_source`
  - source owns `models`
  - `selection_profiles` and reviewed defaults remain relevant
- `dynamic_endpoint`
  - source owns provider runtime metadata and dynamic inventory policy only
  - explicit config model or live-selected model is required at runtime
  - do not invent catalog defaults just to preserve legacy behavior

## Reusable Inputs

- Standard: `runtime/catalog/source/provider-update-report-standard.md`
- General prompt: `runtime/catalog/source/provider-browser-curator-prompt.md`
- Provider-specific prompts: `runtime/catalog/source/prompts/providers/*.md`

## Special Prompt Rule

Use the general prompt by default.

Use a provider-specific prompt when the provider has recurring complexity such
as:

- control-plane or deployment-scoped truth
- heavy aggregate/provider-mall semantics
- workflow-heavy speech or voice assets
- high risk of user-scoped inventory contamination

If a provider-specific prompt exists, prefer it over inventing ad hoc rules in
the moment.

## Output Expectations

When making updates, state clearly:

- scope
- evidence basis
- additions
- removals or deferred removals
- whether `selection_profiles` / defaults were reviewed

If uncertain, bias toward a narrower scoped report rather than a broad provider
rewrite.

## Default Collaboration Rule

For ordinary provider refresh work under `runtime/catalog/source/**`, proceed
without per-provider confirmation by default:

1. audit current source against authority
2. produce the provider update report
3. apply the source refresh
4. run relevant validation

Ask the user for confirmation only when the work is no longer a routine refresh
and instead requires an authority decision, for example:

- changing `inventory_mode` between `static_source` and `dynamic_endpoint`
- splitting, merging, or deleting a provider surface
- resolving multiple plausible canonical source shapes
- changing runtime/adapter behavior beyond normal catalog refresh
- handling control-plane, deployment-scoped, router, or provider-mall semantics
  where more than one defensible design exists

When confirmation is needed, present:

- the viable options
- the recommended option
- the reason for that recommendation
