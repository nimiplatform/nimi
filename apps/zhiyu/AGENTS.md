# Zhiyu App Instructions

- `apps/zhiyu/**` is implementation, not product authority.
- Current Zhiyu formal product authority lives under `.nimi/spec/zhiyu/**`.
- `.nimi/local/plans/zhiyu/**` is background product communication material only. It must not override or compete with `.nimi/spec/zhiyu/**`.
- Product-shape implementation work in `apps/zhiyu` must derive from `.nimi/spec/zhiyu/**` and the admitted upstream owner specs it references.
- Existing app code, tests, screenshots, PP/ZM closeouts, and e2e evidence must not be treated as product authority.
- Zhiyu is the first-party bundled developer-only incubated local partner center. It is not the agent itself, not an AI model consumer, not a tester UI, and not a Runtime dashboard.
- Zhiyu must not create Realm character/persona or local partner authority. If no partner exists, product flow points users to Desktop/Realm-owned creation or management.
- Zhiyu consumes public Runtime/SDK/Kit/Realm/Cognition/Avatar projections and facades only. Do not add app-local auth, token custody, model routing, prompt assembly, agent loop, memory store, avatar carrier truth, or Runtime/private imports.
- Main product UI must remain user-facing and partner-centered. Diagnostics/dev mode may show technical truth, but it must not define the first screen.
