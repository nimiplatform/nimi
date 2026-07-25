# Zhiyu App Instructions

- `apps/zhiyu/**` is implementation, not product authority.
- Current Zhiyu formal product authority lives in `.nimi/spec/zhiyu/local-partner-surface.authority.yaml`, with admitted configuration in `config/zhiyu-*.yaml` and source-preserving rationale in `docs/authority/zhiyu-local-partner-surface-rationale.md`.
- `.nimi/local/plans/zhiyu/**` is background product communication material only. It must not override or compete with the canonical Zhiyu authority, admitted configuration, or source-preserving rationale named above.
- Product-shape implementation work in `apps/zhiyu` must derive from those Zhiyu inputs and the admitted upstream owner specs they reference.
- Existing app code, tests, screenshots, PP/ZM closeouts, and e2e evidence must not be treated as product authority.
- Zhiyu is the first-party bundled developer-only incubated local partner center. It is not the agent itself, not an AI model consumer, not a tester UI, and not a Runtime dashboard.
- Zhiyu must not create Realm character/persona or local partner authority. If no partner exists, product flow points users to Desktop/Realm-owned creation or management.
- Zhiyu consumes public Runtime/SDK/Kit/Realm/Cognition/Avatar projections and facades only. Do not add app-local auth, token custody, model routing, prompt assembly, agent loop, memory store, avatar carrier truth, or Runtime/private imports.
- Main product UI must remain user-facing and partner-centered. Diagnostics/dev mode may show technical truth, but it must not define the first screen.
