# AGENTS.md

## Scope
- Applies to `gateways/**`; gateway packages are out-of-process Runtime consumers.

## Hard Boundaries
- Do not add gateways to the Runtime daemon, import them from `runtime/internal/**`, or use them as hidden app REST bypasses.
- OpenAI-compatible HTTP shapes belong at the gateway boundary only; Runtime remains typed RPC/service authority for grants, routing, readiness, jobs, artifacts, scheduling, and fail-closed errors.
- Do not add static provider/model registries. Public model names must project
  from Runtime-supported image generation targets and fail closed when Runtime
  cannot resolve a target.
- The admitted surface is loopback-only; LAN, pairing, or remote Realm-authenticated exposure requires authority redesign.
- Local API keys protect external HTTP ingress. Runtime grants and `ai.spend.meter` custody remain upstream and cannot be represented as caller-provided OpenAI fields.
- Unsupported fields fail closed; do not silently drop fields or fabricate provider parity.

## Retrieval Defaults
- Start with the affected gateway route, its Runtime client boundary, and its focused tests.
- Read Runtime authority only for a semantic or ownership question; skip unrelated Runtime internals and provider inventories.

## Verification Commands
- Run the affected gateway package test and type/build check.
- Run integration checks only when the Runtime client contract or public HTTP surface changes.
