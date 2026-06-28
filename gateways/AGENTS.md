# AGENTS.md

- Scope: applies to `gateways/**`.
- Gateway packages are out-of-process Runtime consumers. They must not be added
  to the Runtime daemon, imported by `runtime/internal/**`, or used as hidden app
  REST bypasses.
- OpenAI-compatible HTTP shapes belong at the gateway boundary only. Runtime
  remains typed RPC/service authority for grants, model routing, readiness,
  scenario jobs, artifacts, scheduling, and fail-closed errors.
- Do not add static provider/model registries. Public model names must project
  from Runtime-supported image generation targets and fail closed when Runtime
  cannot resolve a target.
- v1 is loopback-only. LAN, device pairing, and Realm-authenticated remote
  service exposure require an explicit later authority patch.
- Local API keys protect external HTTP ingress. Runtime protected grants and
  `ai.spend.meter` token custody remain a separate upstream Runtime integration
  seam and must not be represented as caller-provided OpenAI fields.
- Unsupported OpenAI fields must fail closed. Do not silently drop fields or
  fabricate provider parity.
