# Bedrock Provider Prompt

Use this prompt for `bedrock` source audits and refreshes.

## Focus

- Treat Bedrock as a control-plane and region-sensitive provider.
- Keep foundation-model family truth separate from account enablement and region
  availability details.

## Hard Rules

- Do not elevate account-specific model enablement into provider source truth.
- Distinguish model family identity from inference profile / region rollout
  details.
- Prefer official Bedrock foundation-model docs and release notes.
- If evidence is mostly account-specific, produce a scoped report and defer
  source mutation.

## Primary Evidence

- official Amazon Bedrock model catalog docs
- official AWS release notes
- official regional availability docs

## Typical Pitfalls

- treating account-visible models as canonical inventory
- mixing region rollout state into generic provider truth
- flattening multiple vendor families into one undifferentiated list
