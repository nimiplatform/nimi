# Azure Provider Prompt

Use this prompt for `azure` source audits and refreshes.

## Focus

- Treat Azure as deployment/control-plane sensitive.
- Separate provider capability truth from tenant deployment truth.

## Hard Rules

- Do not treat a tenant's deployed inventory as canonical provider source truth.
- Prefer official Azure model availability docs over portal-instance snapshots.
- Mark deployment-, region-, and quota-specific findings as non-canonical unless
  the source schema explicitly admits them.
- Bias toward `report-only` when evidence is mostly control-plane specific.

## Primary Evidence

- official Azure OpenAI / Azure AI Foundry documentation
- official model availability and API version docs

## Typical Pitfalls

- confusing Azure provider capability with tenant deployment state
- using portal screenshots as authority
- overfitting source truth to one subscription or region
