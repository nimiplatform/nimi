---
name: nimi-authority-work
description: Author or review Nimi canonical authority changes and diagnose authority-command failures. Use for .authority.yaml/.authority.md work, not ordinary implementation that follows settled contracts.
---

# Nimi authority work

Use the project's existing authoring workflow; the host owns task state and product decisions.

- Read the [authority authoring guide](../../../.nimi/methodology/authority-authoring.yaml) for the relevant operation. Reuse task authority and already sufficient context; do not preload the authority corpus or package-internal specifications.
- Invoke Nimi-coding from the repository root through `pnpm exec nimicoding`. Follow the guide's complete-input, query-budget, format, validation, and semantic-change requirements for the operation actually needed.
- Treat query scope and declared impact as bounded evidence, not proof of implementation conformance or task completion. Missing, refused, or incomplete results pause dependent decisions; continue independent authorized work without inventing replacement context.
- Keep product meaning in `.nimi/spec/**`. Local reports and generated results remain non-authoritative; finish with the actual change and validation outcome.
