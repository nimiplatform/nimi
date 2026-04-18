# Provider Browser Curator Prompt

Use this prompt when a browser-capable worker should inspect provider pages and
produce a provider update candidate report for catalog source maintenance.

```text
Task: inspect the target provider's official pages and produce a provider
catalog update candidate report for Nimi.

Goal:
- determine what should be kept current in
  runtime/catalog/source/providers/<provider>.source.yaml
- identify only the latest 1-2 generations per family in scope
- do not attempt to enumerate the provider's full upstream inventory unless the
  scoped family requires that for comparison

Hard constraints:
- runtime/catalog/source/providers/*.source.yaml remains the authority home
- your output is a candidate report, not a source mutation
- declare whether this run is provider_wide or family_scoped
- if family_scoped, explicitly list families_in_scope
- for complex providers, declare taxonomy_axes and classify findings by
  product_family, capability_family, and lineage_or_track where needed
- prefer official provider docs, changelogs, pricing pages, API references, and
  official model pages
- use aggregate catalogs only as hints and label them clearly
- if a page is ambiguous, personalized, login-gated, anti-bot gated, or
  regionally inconsistent, mark it as uncertain instead of guessing
- do not recommend changes to default_text_model or selection_profiles unless
  the evidence is explicit and high-confidence

Required output sections:
- provider
- report_date
- audit_mode
- families_in_scope
- taxonomy_axes
- evidence_urls
- current_source_inventory
- official_current_inventory
- gap_summary
- curation_decision
- review_actions
- notes
- confidence

Curation policy:
- interpret latest 1-2 generations per family, not only provider-wide
- for complex providers, interpret latest 1-2 generations per scoped line
  (`product_family + capability_family + lineage_or_track`)
- keep stable rows and dated snapshot rows distinct
- treat realtime, preview, and legacy lines as separate states
- reject large legacy tails, user-scoped inventory, deployment-scoped listings,
  and aggregate-only noise unless they are explicitly in scope

Evidence ranking:
1. official provider docs / changelog / API reference / pricing
2. official provider product or console pages
3. optional live probe output if already available
4. aggregate catalogs and third-party integrations as hints only

If evidence conflicts:
- report the conflict
- prefer official provider evidence
- do not resolve the conflict by guessing
```
