# Provider-Specific Prompts

This directory stores provider-specific maintenance prompts for catalog source
updates.

Use these only when the general prompt in
`runtime/catalog/source/provider-browser-curator-prompt.md` is too weak for the
provider's shape.

Typical reasons to add a provider-specific prompt:

- provider has multiple product families that must be curated separately
- provider mixes first-party and third-party model mall inventory
- provider exposes deployment-scoped or control-plane-specific truth
- provider has workflow-heavy TTS / ASR / voice asset semantics
- provider pages are structured in a way that regularly defeats the general
  prompt

These prompts are maintenance aids, not authority documents.
