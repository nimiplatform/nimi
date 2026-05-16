# Avatar External Entry Consumer Contract

> Authority: Avatar Kernel
> Topic: `2026-05-16-avatar-external-driver-boundary`

## Scope

This contract owns only how Avatar consumes a Runtime-admitted external-entry
presentation projection.

It does not own external principal identity, gateway verdicts, firewall
verdicts, credential custody, consent posture, protocol adapters, provider/model
routing, audit lineage, or domain writeback.

## Upstream Authority

Avatar external-entry consumption is downstream of:

- `.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`
  `K-AGCORE-079..094`
- `.nimi/spec/runtime/kernel/tables/agent-participation-external-entry-boundaries.yaml`
- `.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md`
  `K-DELEG-100..119`
- `.nimi/spec/runtime/kernel/delegated-a2a-future-seam-contract.md`
  `K-DELEG-120..129`
- `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
  `K-AGCORE-049..051`

Avatar must inherit the external-entry boundary matrix. It must not reinterpret
the matrix locally.

## Consumer Shape

Avatar may render external-entry influence only after Runtime has produced an
admitted typed presentation projection or an explicitly admitted equivalent
Avatar consumer envelope.

The projection must carry Runtime-owned provenance such as `apml_output` or
`direct_api`. `direct_api` means Runtime-admitted direct projection provenance.
It does not mean a browser, localhost, sidecar, plugin, or arbitrary app can
write Avatar state directly.

## Forbidden Local Driver Authority

Avatar MUST NOT expose or own:

- an Avatar-local HTTP endpoint
- an Avatar-local WebSocket endpoint
- a browser-reachable local state endpoint
- a Petdex-style `/state` protocol
- token posture for local driver writes
- rate-limit posture for local driver writes
- user-consent posture for local driver writes
- external provider/model routing
- external credential custody
- external protocol adapter truth

These questions belong to Runtime/external-agent-entry/desktop admission, not to
Avatar.

## No Writeback

External-entry presentation consumption must remain render-only from Avatar's
perspective.

Avatar MUST NOT turn external-entry projections into:

- memory writes
- cognition writes
- canonical chat commits
- Realm GROUP commits
- product-domain commits
- provider/model routing decisions
- package activation or package lifecycle changes

## Fail-Closed Rendering

Avatar must refuse rendering of an external-entry projection when:

- Runtime admission evidence is missing
- required gateway/firewall/audit/credential verdict refs are missing
- provenance is unknown
- the projection attempts writeback
- the projection carries raw MCP/A2A/protocol payloads as semantic fields
- the projection requires an Avatar-local endpoint or local adapter protocol

Refusal must use admitted degraded/debug surfaces. It must not invent a local
fallback driver, localhost state path, fixture carrier, or static success state.

